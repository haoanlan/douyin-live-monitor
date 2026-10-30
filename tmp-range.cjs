const fs = require('fs');
const f = 'frontend/src/views/douyin/detail/index.vue';
let lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
const s = lines.findIndex(l => l.includes('v-if="manualGiftOpen"'));
if (s < 0) { console.log('✗ 找不到面板'); process.exit(1); }
// 深度计数找到面板结尾
let depth = 0, e = -1;
for (let i = s; i < s + 140; i++) {
  const opens = (lines[i].match(/<div\b/g) || []).length;
  const closes = (lines[i].match(/<\/div>/g) || []).length;
  depth += opens - closes;
  if (depth === 0) { e = i; break; }
}
if (e < s + 20) { console.log('✗ 面板范围异常 s=' + s + ' e=' + e); process.exit(1); }
console.log('  面板: L' + (s + 1) + ' ~ L' + (e + 1) + '（' + (e - s + 1) + ' 行）');
console.log('  结尾行: ' + JSON.stringify(lines[e]).slice(0, 80));
fs.writeFileSync('tmp-panel-range.txt', s + ',' + e, 'utf8');
