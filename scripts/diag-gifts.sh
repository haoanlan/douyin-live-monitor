#!/bin/sh
# 礼物丢失诊断 —— 在服务器项目根目录执行：
#   sh scripts/diag-gifts.sh
#
# 只读，不改任何数据。把输出整段发回来即可定性。

echo "===== 1. 版本 ====="
grep -m1 '"version"' package.json 2>/dev/null || echo "(读不到 package.json)"
echo

echo "===== 2. 代理是否活着 ====="
curl -s --max-time 3 http://127.0.0.1:1088/health || echo "(1088 无响应)"
echo
echo "--- 监听端口 ---"
(ss -lntp 2>/dev/null || netstat -lntp 2>/dev/null) | grep -E ':1088|:1089' || echo "(1088/1089 都没在监听)"
echo
echo "--- 代理进程 ---"
ps aux 2>/dev/null | grep -i -E 'douyinLive|douyin-proxy' | grep -v grep || echo "(没有代理进程)"
echo

echo "===== 3. 数据库：最近的数据量 ====="
DB=db/douyin.db
if [ ! -f "$DB" ]; then echo "($DB 不存在)"; else
  if command -v sqlite3 >/dev/null 2>&1; then
    echo "--- 总量 ---"
    sqlite3 "$DB" "SELECT 'gifts', COUNT(*) FROM gifts; SELECT 'danmaku', COUNT(*) FROM danmaku; SELECT 'members', COUNT(*) FROM members;"
    echo "--- 最近 2 小时新增 ---"
    NOW=$(date +%s000)
    TWO_H=$((NOW - 7200000))
    sqlite3 "$DB" "SELECT 'gifts(2h)', COUNT(*) FROM gifts WHERE create_time > $TWO_H; SELECT 'danmaku(2h)', COUNT(*) FROM danmaku WHERE create_time > $TWO_H;"
    echo "--- 最近 5 条礼物 ---"
    sqlite3 -header "$DB" "SELECT id, gift_name, nickname, total_diamonds, datetime(create_time/1000,'unixepoch','localtime') t FROM gifts ORDER BY id DESC LIMIT 5;"
    echo "--- 最近 5 条弹幕 ---"
    sqlite3 -header "$DB" "SELECT id, substr(content,1,20) c, nickname, datetime(create_time/1000,'unixepoch','localtime') t FROM danmaku ORDER BY id DESC LIMIT 5;"
  else
    echo "(没有 sqlite3 命令，改用 node)"
    node -e '
      const D=require("better-sqlite3");const d=new D("db/douyin.db",{readonly:true});
      const t=(s)=>{try{return d.prepare(s).get()}catch(e){return {err:e.message}}};
      console.log("gifts", t("SELECT COUNT(*) c FROM gifts").c);
      console.log("danmaku", t("SELECT COUNT(*) c FROM danmaku").c);
      const now=Date.now();
      console.log("gifts(2h)", t("SELECT COUNT(*) c FROM gifts WHERE create_time > "+(now-7200000)).c);
      console.log("danmaku(2h)", t("SELECT COUNT(*) c FROM danmaku WHERE create_time > "+(now-7200000)).c);
      console.log("last gifts:", JSON.stringify(d.prepare("SELECT gift_name,nickname,total_diamonds,create_time FROM gifts ORDER BY id DESC LIMIT 3").all()));
    '
  fi
fi
echo

echo "===== 4. 日志里礼物消息的情况 ====="
LOG=logs/daemon.log
if [ -f "$LOG" ]; then
  echo "--- daemon.log 大小 / 最后修改 ---"
  ls -l "$LOG"
  echo "--- WebcastGiftMessage 出现次数 ---"
  grep -c 'WebcastGiftMessage' "$LOG" 2>/dev/null || echo 0
  echo "--- 最近 5 条含 gift 的日志 ---"
  grep -i 'gift' "$LOG" | tail -5 || echo "(没有)"
  echo "--- 最近 20 行（看 WS 是否还在收消息）---"
  tail -20 "$LOG"
else
  echo "(没有 $LOG)"
fi
echo

echo "===== 5. 最近的报错 ====="
grep -i -E 'error|失败|异常|ECONN|ETIMEDOUT|SQLITE' logs/daemon.log 2>/dev/null | tail -10 || echo "(无)"
echo

echo "===== 6. 当前在监控的房间是否开播 ====="
tail -40 logs/daemon.log 2>/dev/null | grep -E 'live_status|开播|未开播' | tail -6 || echo "(看不到)"
echo
echo "===== 结束 ====="
