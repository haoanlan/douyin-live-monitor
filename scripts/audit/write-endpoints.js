const fs = require('fs')
const path = require('path')

const dir = 'lib/routes'
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
const guardedRe = /requireAction|requireSuper|currentUser\(|needManage|needLogin|requireLogin|ensureSuper|fromRequest|tokenLib\.verify|X-Upstage-Token/i
const risky = []
let total = 0

for (const f of files) {
  const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n')
  lines.forEach((line, i) => {
    const m = line.match(/pathname\s*===\s*'([^']+)'[^\n]*?req\.method\s*===\s*'(POST|PUT|DELETE|PATCH)'/)
    if (!m) return
    total++
    const win = lines.slice(Math.max(0, i - 6), i + 26).join('\n')
    if (!guardedRe.test(win)) risky.push(`${f}:${i + 1}  ${m[2]} ${m[1]}`)
  })
}
console.log('写接口总数:', total, '| 待人工确认:', risky.length)
risky.forEach((r) => console.log('  -', r))
