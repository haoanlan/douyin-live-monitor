/**
 * 极简 ZIP 打包（只做 STORE，不压缩）。
 *
 * ## 为什么自己写
 *
 * 项目里没有 zip 依赖；为几张已经压过的 JPEG 引入 archiver 不值（deflate 对 JPEG 收益≈0）。
 * 这个实现只写「不压缩」的 ZIP，约 100 行，可用系统解压器和 Windows 资源管理器直接打开。
 *
 * ## 为什么需要
 *
 * 榜单图片会分页（每页 10 人）。原来前端**逐页触发下载**，手机上浏览器只允许第一次下载，
 * 于是"只能下一张 / 下不全"（iOS Safari 和 Android Chrome 都会拦）。
 * 服务端打成 zip 后前端只需要请求一次，一个文件，手机也能存下来。
 *
 * 用法：
 *   const { buildZip } = require('./zip-store');
 *   const buf = buildZip([{ name: '第1页.jpg', data: jpegBuffer }, ...]);
 */

/** CRC32 查表 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** DOS 时间戳（ZIP 头部用的老格式） */
function dosDateTime(d = new Date()) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * @param {{name: string, data: Buffer|Uint8Array|string}[]} entries
 * @returns {Buffer} 完整的 zip 字节
 */
function buildZip(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const { time, date } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of list) {
    const name = Buffer.from(String(e.name || 'file'), 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || '');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0x0800, 6); // bit 11：文件名是 UTF-8
    local.writeUInt16LE(0, 8); // 0 = STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // 压缩后大小（STORE = 原大小）
    local.writeUInt32LE(data.length, 22); // 原大小
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra 长度
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    central.writeUInt16LE(20, 4); // 创建版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42); // 本地头偏移
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // 中央目录结束签名
  eocd.writeUInt16LE(0, 4); // 当前盘
  eocd.writeUInt16LE(0, 6); // 中央目录起始盘
  eocd.writeUInt16LE(list.length, 8);
  eocd.writeUInt16LE(list.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 注释长度

  return Buffer.concat([...locals, centralBuf, eocd]);
}

module.exports = { buildZip };
