/**
 * 自检 2：后端接口有没有前端在用（找"死接口"）。
 * 只做提示，不自动删：可能有外部脚本/运维命令在用。
 */
const fs = require('fs')
const path = require('path')

// 1) 收集后端 pathname
const routesDir = 'lib/routes'
const endpoints = new Map() // path -> file:line
for (const f of fs.readdirSync(routesDir).filter((x) => x.endsWith('.js'))) {
  const lines = fs.readFileSync(path.join(routesDir, f), 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = line.match(/pathname\s*===\s*'(\/api\/[^']*)'/)
    if (m) endpoints.set(m[1], `${f}:${i + 1}`)
    const mm = line.match(/pathname\.match\(\/\^(\/api\/[^/]+)/)
    if (mm) endpoints.set(mm[1] + '/…', `${f}:${i + 1}`)
  })
}

// 2) 收集前端源码文本（含 api 层）
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|vue)$/.test(e.name)) out.push(p)
  }
  return out
}
const srcFiles = walk('frontend/src')
let srcText = ''
for (const f of srcFiles) srcText += fs.readFileSync(f, 'utf8') + '\n'

// 3) 比对：后端有、前端完全没有字符串
const missing = []
for (const [ep, where] of endpoints) {
  if (ep.endsWith('/…')) continue
  // 前端可能拼动态 id，这里用前缀匹配（去掉最后一段）
  const prefix = ep.replace(/\/[^/]*$/, '')
  const used = srcText.includes(ep) || (prefix !== ep && srcText.includes(prefix + '/'))
  if (!used) missing.push(`${ep.padEnd(42)} ${where}`)
}

console.log('后端 endpoint 数（静态可识别）:', endpoints.size)
console.log('前端未引用的接口:', missing.length)
missing.forEach((m) => console.log('  -', m))
