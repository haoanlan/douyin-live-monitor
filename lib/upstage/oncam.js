/**
 * 团播「谁在麦上」人脸识别消息（OnCamRecognition）的解码器。
 *
 * 为什么不写在 Go 侧用 proto：
 *   官方 douyinlive-proto 仓库没有这个 message 定义，而字段里我们只要 uid + 置信度，
 *   手解 wire 格式最省事、也不怕对面加字段。Go 代理那边只做一件事：
 *   把未注册 method 的原始 payload 以 ``payloadB64`` 转出来（见我们打的补丁）。
 *
 * 实测报文结构（房间 65209552987，2026-11-11 抓的 6 个样本完全一致）：
 *
 *   root
 *     field 1 = header（method / msgId 等，不关心）
 *     field 2 = body
 *                field 1 = category    （varint，样本里都是 1）
 *                field 2 = repeated person
 *                            field 1 = uid        （字符串，19 位也不丢精度）
 *                            field 3 = confidence （double，样本 0.44–0.50）
 *                            field 4 = box        （4 个 varint：左/上/宽/高）
 *                field 4 = timestamp   （字符串形式的毫秒时间戳）
 *
 * 注意：解析要**宽容** —— 只取认识的字段，其它一律跳过；
 * 一条消息里可能有多个人（field 2 出现多次）。
 */

/**
 * 读 varint。
 * 用 BigInt 累加：msg_id / room_id 是 64 位，用 Number 累加会丢末位（和 uid 那次一样的坑）。
 * 返回 { value: number(安全时) , big: BigInt, pos }。
 */
function readVarint(buf, pos) {
  let big = 0n;
  let shift = 0n;
  let byte;
  do {
    if (pos >= buf.length) throw new Error('varint 越界');
    byte = buf[pos++];
    big |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
  } while (byte & 0x80);
  return { value: big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : Number(big), big, pos };
}

/** 把一段 protobuf 解析成 [{ field, wire, ... }] */
function readFields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    pos = tag.pos;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value & 7;
    if (!field) break;

    if (wire === 0) {
      const v = readVarint(buf, pos);
      pos = v.pos;
      out.push({ field, wire, value: v.value, big: v.big });
    } else if (wire === 1) {
      if (pos + 8 > buf.length) break;
      out.push({ field, wire, double: buf.readDoubleLE(pos) });
      pos += 8;
    } else if (wire === 2) {
      const len = readVarint(buf, pos);
      pos = len.pos;
      const end = pos + len.value;
      if (end > buf.length) break;
      out.push({ field, wire, bytes: buf.subarray(pos, end) });
      pos = end;
    } else if (wire === 5) {
      if (pos + 4 > buf.length) break;
      out.push({ field, wire, float: buf.readFloatLE(pos) });
      pos += 4;
    } else {
      // 不认识的 wire type（3/4 是已废弃的 group），直接放弃
      break;
    }
  }
  return out;
}

/** 所有出现过的 field（repeated 字段会有多条） */
function all(fields, field) {
  return fields.filter((f) => f.field === field);
}

/** 第一个出现的 field */
function first(fields, field) {
  return fields.find((f) => f.field === field);
}

function toText(f) {
  if (!f || f.wire !== 2) return '';
  // uid / 时间戳都是纯 ASCII 数字
  return f.bytes.toString('utf8').replace(/\0/g, '').trim();
}

/**
 * @param {Buffer} buf protobuf 原始字节
 * @returns {{items: {uid: string, confidence: number, box: number[]|null}[], category: number|null, timestamp: number|null}}
 */
function parseOnCam(buf) {
  const empty = { items: [], category: null, timestamp: null };
  if (!Buffer.isBuffer(buf) || !buf.length) return empty;

  let root;
  try {
    root = readFields(buf);
  } catch {
    return empty;
  }

  // body 正常在 root field 2；有些版本可能直接是 root，兜底都试一遍
  const bodyField = first(root, 2);
  let body = root;
  if (bodyField && bodyField.wire === 2) {
    const inner = readFields(bodyField.bytes);
    // 只有里层看起来像业务体（有 uid 或 category）时才替换
    if (inner.length && (all(inner, 2).length || first(inner, 1))) body = inner;
  }

  const items = [];
  for (const f of all(body, 2)) {
    if (f.wire !== 2) continue;
    let sub;
    try {
      sub = readFields(f.bytes);
    } catch {
      continue;
    }
    const uid = toText(first(sub, 1));
    // uid 必须是纯数字：这个字段在别的 message 里可能不是 uid，靠这个筛掉误判
    if (!uid || !/^\d{5,20}$/.test(uid)) continue;
    const confField = first(sub, 3);
    const boxField = first(sub, 4);
    let box = null;
    if (boxField && boxField.wire === 2) {
      try {
        const b = readFields(boxField.bytes);
        box = [0, 1, 2, 3].map((i) => (first(b, i + 1)?.value ?? null));
      } catch {
        box = null;
      }
    }
    items.push({
      uid,
      confidence: confField && confField.wire === 1 ? Number(confField.double.toFixed(4)) : 0,
      box
    });
  }

  const categoryField = first(body, 1);
  const tsField = first(body, 4);
  const tsText = toText(tsField);
  return {
    items,
    category: categoryField && categoryField.wire === 0 ? categoryField.value : null,
    timestamp: /^\d{10,14}$/.test(tsText) ? Number(tsText) : null
  };
}

/**
 * 解析整条 Webcast_Im_Message（代理补丁额外给的 messageB64）。
 * 字段（proto）：
 *   1 method(string) 2 payload(bytes) 3 msg_id(uint64) 4 msg_type(int32)
 *   5 offset(uint64) 6 need_wrds_store(bool) 7 wrds_version(uint64)
 *   8 wrds_sub_key(string) 9 message_extra(map) 10 tenant_id(string)
 */
function parseImMessage(buf) {
  const empty = { method: '', payload: null, msgId: '', msgType: null, offset: '', messageExtra: {}, tenantId: '' };
  if (!Buffer.isBuffer(buf) || !buf.length) return empty;
  let fields;
  try {
    fields = readFields(buf);
  } catch {
    return empty;
  }
  const get = (n) => fields.find((f) => f.field === n);
  const asText = (f) => (f && f.wire === 2 ? f.bytes.toString('utf8') : '');
  const asBig = (f) => (f && f.wire === 0 ? f.big.toString() : '');

  // message_extra 是 map<string,string>：每条 field 9 里再套 key/value 两条 field 1/2
  const extra = {};
  for (const f of fields.filter((x) => x.field === 9 && x.wire === 2)) {
    try {
      const kv = readFields(f.bytes);
      const k = asText(kv.find((x) => x.field === 1));
      const v = asText(kv.find((x) => x.field === 2));
      if (k) extra[k] = v;
    } catch {
      /* 忽略 */
    }
  }

  return {
    method: asText(get(1)),
    payload: get(2) && get(2).wire === 2 ? get(2).bytes : null,
    msgId: asBig(get(3)),
    msgType: get(4) ? get(4).value : null,
    offset: asBig(get(5)),
    messageExtra: extra,
    tenantId: asText(get(10))
  };
}

module.exports = { parseOnCam, parseImMessage };
