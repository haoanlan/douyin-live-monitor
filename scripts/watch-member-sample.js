#!/usr/bin/env node
/**
 * 采样观众的消费等级 / 粉丝团（调试用，不写库）
 *
 *   node scripts/watch-member-sample.js <roomId> [代理端口]
 *   node scripts/watch-member-sample.js 65209552987 1088
 *
 * 连上代理的 /ws/<roomId>，等到「成员进场」消息后，把 user 里的
 * payGrade（消费等级，带图标）/ fansClub（粉丝团）原样打印出来，然后退出。
 *
 * 为什么需要它：消费等级只在**直播中**的消息里下发，历史库里没有；
 * 想确认某个熟人（比如「404」「焕屿」）到底是什么等级，只能在开播时抓一条。
 */
const WebSocket = require('ws');

const roomId = process.argv[2];
const port = process.argv[3] || '1088';
if (!roomId) {
  console.error('用法: node scripts/watch-member-sample.js <roomId> [port]');
  process.exit(1);
}

const url = `ws://127.0.0.1:${port}/ws/${roomId}`;
console.log(`连接 ${url} …（等成员进场消息，Ctrl+C 退出）`);

const ws = new WebSocket(url);
let count = 0;
const seen = new Set();

ws.on('open', () => console.log('已连接，等待消息…'));
ws.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });

ws.on('message', (raw) => {
  let data;
  try { data = JSON.parse(raw.toString()); } catch { return; }
  const method = data.method || data.common?.method || '';
  // 进场消息带得最全，礼物消息频率更高 —— 两种都采，样本来的快
  if (method !== 'WebcastMemberMessage' && method !== 'WebcastGiftMessage') return;

  count++;
  const u = data.user || data.userValue?.user || {};
  const name = u.nickname || '(无昵称)';
  const pay = u.payGrade || {};
  const club = (u.fansClub || {}).data || {};
  const iconUrl =
    pay.newImIconWithLevel?.urlList?.[0] ||
    pay.imIconWithLevel?.urlList?.[0] ||
    pay.icon?.urlList?.[0] || '';

  console.log(`\n[第 ${count} 条成员消息] ${name}`);
  console.log('  用户等级 User.level      :', u.level ?? '(无)');
  console.log('  消费等级 PayGrade.level  :', pay.level ?? '(无)', pay.name ? `「${pay.name}」` : '');
  console.log('  消费等级图标 URL         :', iconUrl || '(无)');
  console.log('  粉丝团                   :', club.clubName ? `${club.clubName} Lv.${club.level ?? '?'}` : '(无)');
  console.log('  原始 payGrade            :', JSON.stringify(pay).slice(0, 400));
  console.log('  原始 fansClub.data       :', JSON.stringify(club).slice(0, 300));

  // 同一个人只打一次，避免刷屏；想继续看就多等几个人
  if (seen.has(name)) return;
  seen.add(name);
  if (seen.size >= 10) {
    console.log('\n已采样 10 个不同用户，退出。');
    ws.close();
    process.exit(0);
  }
});
