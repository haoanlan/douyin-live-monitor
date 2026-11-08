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

function buildBody(type, payload) {
  const { title = '', text = '' } = payload;
  const plain = title ? `${title}\n${text}` : text;
  switch (type) {
    case 'wecom':
      return { msgtype: 'text', text: { content: plain } };
    case 'feishu':
      // 飞书 text 消息：不需要签名时最省事
      return { msg_type: 'text', content: { text: plain } };
    case 'dingtalk':
      return { msgtype: 'text', text: { content: plain } };
    default:
      return { title, text, content: plain };
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
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildBody(type, payload)),
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
      if (code !== 0) return { ok: false, error: `接口返回 ${code}: ${j.errmsg || j.msg || bodyText.slice(0, 160)}` };
    } catch {
      /* 纯文本响应视为成功 */
    }
    return { ok: true, error: '' };
  } catch (e) {
    const msg = e?.name === 'AbortError' ? `请求超时（${TIMEOUT_MS}ms）` : e.message || String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendToChannel, buildBody };
