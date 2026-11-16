/**
 * 重算历史场次的预聚合（连击去重逻辑修正后必须跑一次）。
 *
 * 用法：
 *   node scripts/recompute-sessions.js            # 最近 30 场
 *   node scripts/recompute-sessions.js --all      # 全部
 *   node scripts/recompute-sessions.js --since 387
 *   node scripts/recompute-sessions.js --dry-run
 */
const db = require('../db-sqlite.js');

const args = process.argv.slice(2);
const all = args.includes('--all');
const dryRun = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const since = sinceIdx >= 0 ? parseInt(args[sinceIdx + 1], 10) : null;

(async () => {
  await db.init();
  const d = db.getDb();
  let ids;
  if (all) {
    ids = d.prepare('SELECT id FROM sessions ORDER BY id').all().map((r) => r.id);
  } else if (since) {
    ids = d.prepare('SELECT id FROM sessions WHERE id >= ? ORDER BY id').all(since).map((r) => r.id);
  } else {
    ids = d.prepare('SELECT id FROM sessions ORDER BY id DESC LIMIT 30').all().map((r) => r.id).reverse();
  }
  console.log(`待重算场次: ${ids.length} 个${dryRun ? '（dry-run，不写库）' : ''}`);

  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    if (dryRun) { console.log(`  #${id}（跳过）`); continue; }
    try {
      await db.recomputeSessionAggregates(id);
      ok++;
      if (ok % 20 === 0) console.log(`  已完成 ${ok}/${ids.length}`);
    } catch (e) {
      fail++;
      console.warn(`  #${id} 重算失败: ${e.message}`);
    }
  }
  console.log(`\n完成: 成功 ${ok} | 失败 ${fail}`);
})();
