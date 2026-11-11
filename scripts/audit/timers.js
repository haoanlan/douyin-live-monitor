/**
 * 自检 4：前端定时器/事件监听是否有清理（防内存泄漏、后台偷偷请求）。
 */
const fs = require('fs')
const path = require('path')

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(e.name)) out.push(p)
  }
  return out
}

let issues = 0
for (const f of walk('frontend/src')) {
  const src = fs.readFileSync(f, 'utf8')
  const hasInterval = /setInterval\(/.test(src) || /window\.setInterval\(/.test(src)
  const hasTimeout = /setTimeout\(/.test(src) || /window\.setTimeout\(/.test(src)
  const hasListener = /addEventListener\(/.test(src)
  const hasObserver = /new (IntersectionObserver|ResizeObserver|MutationObserver)/.test(src)
  if (!hasInterval && !hasTimeout && !hasListener && !hasObserver) continue

  const cleans = {
    interval: /clearInterval\(/.test(src),
    timeout: /clearTimeout\(/.test(src),
    listener: /removeEventListener\(/.test(src),
    observer: /\.disconnect\(\)/.test(src),
    unmount: /onUnmounted\(|onDeactivated\(|onBeforeUnmount\(/.test(src)
  }
  const missing = []
  if (hasInterval && !cleans.interval) missing.push('setInterval 未 clearInterval')
  if (hasListener && !cleans.listener) missing.push('addEventListener 未 removeEventListener')
  if (hasObserver && !cleans.observer) missing.push('Observer 未 disconnect')
  if ((hasInterval || hasTimeout || hasObserver) && !cleans.unmount) missing.push('没有 onUnmounted/onDeactivated 清理钩子')

  if (missing.length) {
    issues++
    console.log(f.replace('frontend/src/', '') + '  →  ' + missing.join('；'))
  }
}
console.log('\n有清理风险的文件数:', issues)
