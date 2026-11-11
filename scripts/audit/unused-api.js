/**
 * 自检 3：前端 api 层里"导出了但没人 import"的函数。
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
const apiFiles = fs.readdirSync('frontend/src/api').filter((f) => f.endsWith('.ts')).map((f) => 'frontend/src/api/' + f)
const srcFiles = walk('frontend/src')

let allText = ''
for (const f of srcFiles) allText += fs.readFileSync(f, 'utf8') + '\n'

for (const apiFile of apiFiles) {
  const text = fs.readFileSync(apiFile, 'utf8')
  const names = [...text.matchAll(/export function (\w+)/g)].map((m) => m[1])
  const unused = names.filter((n) => {
    // 自己文件里出现不算
    const others = allText.split(text).join('')
    return !new RegExp('\\b' + n + '\\b').test(others)
  })
  console.log(`\n${path.basename(apiFile)}  (导出 ${names.length})`)
  if (unused.length) console.log('  未被引用:', unused.join(', '))
  else console.log('  全部有引用')
}
