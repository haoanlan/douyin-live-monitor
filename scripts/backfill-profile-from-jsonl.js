#!/usr/bin/env node
/**
 * 从 WS 抓包 jsonl 回填观众档案（等级 / 消费等级 / 粉丝团归属）
 *
 *   node scripts/backfill-profile-from-jsonl.js <ws_all.jsonl> [--dry]
 *
 * 用途：历史抓包里有真实的进场/礼物消息，但当时还没做等级采集，
 * 这份脚本把里面的 user.payGrade / user.fansClub 抽出来写进 user_profiles，
 * 顺便用「礼物消息的 toUser（id + secUid）」建立 anchorId → 主播 的映射，
 * 这样团播里"这个人的粉丝团是谁的"就能显示出来。
 *
 * 只新增/更新 user_profiles 与 anchor_ids 两张表，不动任何业务表。
 */
const fs = require('fs');
const readline = require('readline');
const Database = require('better-sqlite3');
const path = require('path');

const store = require('../lib/profile/store');

const file = process.argv[2];
const dry = process.argv.includes('--dry');
if (!file || !fs.existsSync(file)) {
  console.error('用法: node scripts/backfill-profile-from-jsonl.js <ws_all.jsonl> [--dry]');
  process.exit(1);
}

const db = new Database(path.join(__dirname, '..', 'db', 'douyin.db'));
db.pragma('busy_timeout = 5000');
store.ensure(db);

(async () => {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let lines = 0;
  let msgCount = 0;
  let profileCount = 0;
  let anchorCount = 0;
  const seenUsers = new Set();
  const seenAnchors = new Set();

  for await (const line of rl) {
    lines++;
    if (!line || line.length < 20) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const method = d.method || d.common?.method || '';
    if (method !== 'WebcastMemberMessage' && method !== 'WebcastGiftMessage') continue;
    msgCount++;

    const u = d.user || d.userValue?.user || {};

    // 主播身份映射（礼物消息的收礼人）
    const to = d.toUser;
    if (to && to.id) {
      seenAnchors.add(String(to.id));
      if (!dry) {
        store.recordAnchor(db, to.id, {
          secUid: to.secUid || '',
          nickname: to.nickname || '',
          avatar: to.avatarThumb?.urlList?.[0] || ''
        });
      }
      anchorCount++;
    }

    // 观众档案
    const sec = u.secUid || '';
    if (!sec) continue;
    const prof = store.extractProfile(u);
    if (!prof) continue;
    seenUsers.add(sec);
    if (!dry) {
      store.recordProfile(db, sec, prof, {
        nickname: u.nickname || '',
        avatar: u.avatarThumb?.urlList?.[0] || '',
        force: true
      });
    }
    profileCount++;
  }

  const users = db.prepare('SELECT COUNT(1) n FROM user_profiles').get().n;
  const anchors = db.prepare('SELECT COUNT(1) n FROM anchor_ids').get().n;
  const withAnchor = db
    .prepare('SELECT COUNT(1) n FROM user_profiles WHERE club_anchor_id IS NOT NULL')
    .get().n;

  console.log(`读完 ${lines} 行 / 相关消息 ${msgCount} 条${dry ? '（dry-run，未写库）' : ''}`);
  console.log(`档案写入次数 ${profileCount}（涉及 ${seenUsers.size} 个用户）`);
  console.log(`主播映射写入次数 ${anchorCount}（涉及 ${seenAnchors.size} 个主播）`);
  console.log(`\n库内现状：user_profiles ${users} 行，anchor_ids ${anchors} 行，其中带粉丝团归属 ${withAnchor} 人`);

  if (!dry) {
    const sample = db
      .prepare(
        `SELECT p.nickname, p.pay_level, p.club_level, p.club_status,
                a.nickname AS anchor
           FROM user_profiles p LEFT JOIN anchor_ids a ON a.anchor_id = p.club_anchor_id
          WHERE p.pay_level IS NOT NULL
          ORDER BY p.pay_level DESC LIMIT 5`
      )
      .all();
    console.log('\n样本（按消费等级降序）：');
    for (const s of sample) {
      console.log(`  ${s.nickname}  消费 Lv.${s.pay_level}  粉丝团 ${s.club_level ?? '-'}（${s.anchor || '归属未知'}）${s.club_status === 2 ? ' 已退团' : ''}`);
    }
  }
  db.close();
})();
