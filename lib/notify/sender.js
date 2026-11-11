/**
 * 通知发送（渠道适配 + 失败原因回传）。
 *
 * 支持的类型：
 *   wecom     企业微信群机器人  https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...
 *   feishu    飞书自定义机器人    https://open.feishu.cn/open-apis/bot/v2/hook/...
 *   dingtalk  钉钉自定义机器人    https://oapi.dingtalk.com/robot/send?access_token=...
 *   webhook   自定义：直接 POST JSON { title, text }
 *
 * 统一返回 { ok, error }，不抛异常 —— 通知失败不能影响主流程（战报生成、开播判定）。
 */

const TIMEOUT_MS = 8000;

/**
 * 按 URL 反推平台。
 *
 * 为什么需要：渠道类型是用户手选的，但 URL 一贴就能看出是哪家机器人。
 * 实测踩过：URL 是飞书（open.feishu.cn），类型却选了「企业微信」，
 * 于是发出去的 body 用 `msgtype`，飞书回 `19002 params error, msg_type need` ——
 * 错误信息完全看不出"是你类型选错了"。
 */
function detectTypeByUrl(url) {
  const u = String(url || '');
  if (/qyapi\.weixin\.qq\.com/i.test(u)) return 'wecom';
  if (/open\.feishu\.cn/i.test(u)) return 'feishu';
  if (/oapi\.dingtalk\.com/i.test(u)) return 'dingtalk';
  return null;
}

const TYPE_LABEL = { wecom: '企业微信', feishu: '飞书', dingtalk: '钉钉', webhook: '自定义 Webhook' };

/**
 * 飞书「图文卡片」：把事件排成卡片（无需应用凭证，webhook 直接能用）。
 *
 * 为什么不用图片：飞书自定义机器人发图要先调 /im/v1/images 换 image_key，
 * 那需要 app_id/app_secret；而 interactive 卡片 webhook 原生支持。
 *
 * 版式（按用户看到的截图调过）：
 *   · header 按事件配色：开播=红色（醒目）、下播=绿色、其它=蓝色；
 *   · 字段用单行 `**标签** 值`，两列并排 —— 比"标签一行、值一行"紧凑得多；
 *   · 底部 note 放场次号 / 时间这类灰色小字。
 */
const HEADER_TEMPLATE = { live_start: 'red', live_end_report: 'green' };

function buildFeishuCard({ title = '', text = '', fields = [], note = '', event = '' }) {
  const elements = [];
  if (text) elements.push({ tag: 'div', text: { tag: 'lark_md', content: text } });
  if (fields.length) {
    if (elements.length) elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      fields: fields.map((f) => ({
        is_short: true,
        text: { tag: 'lark_md', content: `**${f.label}**　${f.value}` }
      }))
    });
  }
  if (note) {
    elements.push({
      tag: 'note',
      elements: [{ tag: 'plain_text', content: note }]
    });
  }
  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        template: HEADER_TEMPLATE[event] || 'blue',
        title: { tag: 'plain_text', content: title || '直播提醒' }
      },
      elements
    }
  };
}

function buildBody(type, payload) {
  const { title = '', text = '', fields = [], image } = payload;

  // 企业微信机器人支持直接发图片（base64 + md5，≤2MB），不需要任何凭证
  if (type === 'wecom' && image?.base64) {
    return { msgtype: 'image', image: { base64: image.base64, md5: image.md5 } };
  }
  // 飞书：有结构化字段就发卡片，否则退回纯文本
  if (type === 'feishu' && (fields.length || payload.card)) {
    return payload.card ? { msg_type: 'interactive', card: payload.card } : buildFeishuCard(payload);
  }

  /*
   * 纯文本渠道（企业微信 / 钉钉 / 自定义 webhook / 飞书的 text 模式）没有卡片，
   * 只能用一段文字表达。"text" 现在只放直播间标题（飞书卡片里数字走 fields，
   * 避免重复），所以这里必须优先用 payload.plain（标题 + 一行数字摘要），
   * 否则这些渠道会丢掉全部数字。
   */
  const bodyText = payload.plain || text;
  const plain = title ? `${title}\n${bodyText}` : bodyText;
  switch (type) {
    case 'wecom':
      return { msgtype: 'text', text: { content: plain } };
    case 'feishu':
      // 飞书 text 消息：不需要签名时最省事
      return { msg_type: 'text', content: { text: plain } };
    case 'dingtalk':
      return { msgtype: 'text', text: { content: plain } };
    default:
      return { title, text: bodyText, content: plain };
  }
}

/**
 * @param {{type:string,name?:string,config:{url?:string,token?:string}}} channel
 * @param {{title?:string,text?:string}} payload
 */
async function sendToChannel(channel, payload) {
  const type = String(channel?.type || 'webhook');
  const cfg = channel?.config || {};
  let url = String(cfg.url || '').trim();

  if (!url) return { ok: false, error: '渠道未配置 URL' };

  // 企业微信/钉钉允许只填 key/token，这里拼成完整地址
  if (type === 'wecom' && !/^https?:/i.test(url)) {
    url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(url)}`;
  } else if (type === 'dingtalk' && !/^https?:/i.test(url)) {
    url = `https://oapi.dingtalk.com/robot/send?access_token=${encodeURIComponent(url)}`;
  } else if (type === 'feishu' && !/^https?:/i.test(url)) {
    url = `https://open.feishu.cn/open-apis/bot/v2/hook/${encodeURIComponent(url)}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  /*
   * 类型以 URL 为准：用户选错类型时自动按 URL 纠正（并在日志里留一句提示），
   * 而不是把一条看不懂的 19002 丢给用户。
   */
  const urlType = detectTypeByUrl(url);
  const effectiveType = urlType || type;
  const typeMismatch = urlType && urlType !== type;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(effectiveType, payload)),
      signal: controller.signal
    });
    const bodyText = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${bodyText.slice(0, 200)}` };
    }
    // 企业微信/钉钉/飞书成功时也会返回 errcode / code 字段
    try {
      const j = JSON.parse(bodyText);
      const code = j.errcode ?? j.code ?? j.StatusCode ?? 0;
      if (code !== 0) {
        const hint = typeMismatch
          ? `（渠道类型填的是「${TYPE_LABEL[type] || type}」，但 URL 是${TYPE_LABEL[urlType]}机器人，已按 URL 格式重发仍失败）`
          : '';
        return { ok: false, error: `接口返回 ${code}: ${j.errmsg || j.msg || bodyText.slice(0, 160)}${hint}` };
      }
    } catch {
      /* 纯文本响应视为成功 */
    }
    /*
     * 类型被纠正时仍旧算 sent，但把提示写进 error 字段 —— 它会进 notify_logs，
     * 用户翻"发送记录"就能看到"该把类型改成飞书"。
     */
    const note = typeMismatch
      ? `渠道类型「${TYPE_LABEL[type] || type}」与 URL（${TYPE_LABEL[urlType]}）不一致，已自动按 ${TYPE_LABEL[urlType]} 格式发送；建议把类型改过来`
      : '';
    return { ok: true, error: note };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `请求超时（${TIMEOUT_MS}ms）` : e.message || String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendToChannel, buildBody, buildFeishuCard, detectTypeByUrl };
