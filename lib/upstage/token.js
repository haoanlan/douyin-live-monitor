/**
 * 外部识别进程用的服务令牌。
 *
 * 为什么需要：人脸识别帧来自外部采集进程（Go 代理没有这个 proto），
 * 它没法带用户登录态，也不能把管理员密码塞进脚本。
 * 这里生成一个进程级随机令牌，写在「通知管理 → 上场提醒」页面上，
 * 采集进程用 `X-Upstage-Token` 头提交帧即可。
 *
 * 令牌每进程重新生成（跟 auth-token 一样），重启后需要在脚本里更新。
 */
const crypto = require('crypto');

const TOKEN = crypto.randomBytes(18).toString('hex');

function current() {
  return TOKEN;
}

function verify(req) {
  const got = String(req.headers?.['x-upstage-token'] || '');
  if (!got || got.length !== TOKEN.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN));
  } catch {
    return false;
  }
}

module.exports = { current, verify };
