#!/usr/bin/env bash
# =============================================================================
# douyin-live-monitor 一键部署（非 Docker，systemd 托管）
#
#   用法：
#     1) 先把「发布包内容」和「代理二进制」放到目标目录（例如 /opt/douyin-monitor）
#     2) bash deploy/deploy.sh [安装目录，默认 /opt/douyin-monitor]
#
#   特点：
#     · 不用 root 运行（脚本内部用 sudo）
#     · 可重复执行（幂等）：已装依赖不重装、已有 config.yaml 不覆盖
#     · 进程交给 systemd：断开 SSH / 关机重启都不影响，崩溃自动重启
# =============================================================================
set -euo pipefail

APP_DIR="${1:-/opt/douyin-monitor}"
SERVICE="douyin-live"
RUN_USER="$(id -un)"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[警告] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[失败] %s\033[0m\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
say "0/8 环境检查"
[ "$EUID" -eq 0 ] && die "请不要用 root/sudo 直接运行本脚本（内部会用 sudo），用普通用户执行"
command -v apt-get >/dev/null || die "只支持 Debian / Ubuntu（未找到 apt-get）"
command -v systemctl >/dev/null || die "未找到 systemctl（这个脚本依赖 systemd）"
say "    用户: $RUN_USER   目录: $APP_DIR"

# -----------------------------------------------------------------------------
say "1/8 系统依赖（python3 / make / g++ / unzip / curl）"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  python3 make g++ unzip curl ca-certificates >/dev/null
echo "    已就绪 ✓"

# -----------------------------------------------------------------------------
say "2/8 Node.js（要求 >= 20.19，推荐 22）"
NEED_INSTALL=0
if ! command -v node >/dev/null 2>&1; then
  NEED_INSTALL=1
else
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$NODE_MAJOR" -lt 20 ] && NEED_INSTALL=1
fi
if [ "$NEED_INSTALL" = "1" ]; then
  echo "    安装 Node 22 ..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/dev/null
  sudo apt-get install -y -qq nodejs >/dev/null
fi
echo "    Node: $(node -v)   npm: $(npm -v)"

# -----------------------------------------------------------------------------
say "3/8 准备目录与文件"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"
cd "$APP_DIR"
echo "    工作目录: $(pwd)"

[ -f web-dashboard.js ] || die "缺少 web-dashboard.js —— 请先把发布包解压到 $APP_DIR"
[ -f douyinLive-linux-amd64 ] || die "缺少 douyinLive-linux-amd64（代理二进制）—— 请 scp 到 $APP_DIR 后重跑"
chmod +x douyinLive-linux-amd64
echo "    代理二进制: $(du -h douyinLive-linux-amd64 | cut -f1) ✓"

CONFIG_NEW=0
if [ ! -f config.yaml ]; then
  cp config.example.yaml config.yaml
  CONFIG_NEW=1
  warn "已生成 config.yaml —— 需要填抖音 cookie！"
fi
mkdir -p db logs

# -----------------------------------------------------------------------------
say "4/8 安装后端依赖（better-sqlite3 会编译，1-2 分钟）"
if [ -d node_modules/better-sqlite3/build/Release ]; then
  echo "    better-sqlite3 已编译过，跳过 npm install"
else
  npm install --omit=dev --no-audit --no-fund
fi
node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('    better-sqlite3 冒烟测试 OK ✓')"

# -----------------------------------------------------------------------------
say "5/8 前端构建产物"
if [ -f frontend/dist/index.html ]; then
  echo "    frontend/dist 已存在（发布包自带），跳过构建 ✓"
else
  warn "缺少 frontend/dist —— 现场构建前端（需要 1-3 分钟）"
  ( cd frontend && npm install --no-audit --no-fund >/dev/null && npm run build )
fi
[ -f frontend/dist/index.html ] || die "frontend/dist 仍缺失，前端构建失败"
echo "    frontend/dist ✓"

# -----------------------------------------------------------------------------
say "6/8 写入 systemd 单元 /etc/systemd/system/$SERVICE.service"
sudo tee "/etc/systemd/system/$SERVICE.service" >/dev/null <<EOF
[Unit]
Description=Douyin Live Monitor (dashboard + embedded worker)
Documentation=file://$APP_DIR/README.md
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) web-dashboard.js
Restart=always
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30
StartLimitIntervalSec=300
StartLimitBurst=10

Environment=NODE_ENV=production
Environment=DASHBOARD_HOST=127.0.0.1
Environment=DASHBOARD_PORT=9871

StandardOutput=journal
StandardError=journal
SyslogIdentifier=douyin-live

NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
echo "    已写入 ✓"

# -----------------------------------------------------------------------------
say "7/8 启动并设为开机自启"
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE" >/dev/null 2>&1 || true
sleep 6
sudo systemctl --no-pager --lines=0 status "$SERVICE" | head -8 || true

# -----------------------------------------------------------------------------
say "8/8 健康检查（最多等 60 秒）"
CODE=""
for _ in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9871/ || true)"
  [ "$CODE" = "200" ] && break
  sleep 2
done

API_CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9871/api/overview || true)"

echo ""
echo "  首页 HTTP:        ${CODE:-无响应}"
echo "  /api 无 token:    ${API_CODE:-无响应}   （应为 401）"

if [ "$CODE" = "200" ] && [ "$API_CODE" = "401" ]; then
  printf '\033[1;32m\n  ✅ 部署成功\033[0m\n'
else
  printf '\033[1;31m\n  ❌ 健康检查未通过，请看日志：\033[0m\n'
  echo "     sudo journalctl -u $SERVICE -n 60 --no-pager"
  exit 1
fi

# -----------------------------------------------------------------------------
cat <<EOT

------------------------------------------------------------------
访问方式
  http://<服务器IP>:9871        默认账号 admin / 123456（请立刻改密）
  （仪表盘默认只绑 127.0.0.1；要外网访问请改 config.yaml 的 dashboard.host 或挂 Nginx）

常用命令
  sudo systemctl status  $SERVICE         # 状态
  sudo systemctl restart $SERVICE         # 重启
  sudo journalctl -u $SERVICE -f          # 实时日志（Ctrl+C 不影响服务）
  sudo systemctl disable --now $SERVICE   # 停止并取消开机自启

注意
  · 这个服务由 systemd 托管：断开 SSH / 关闭终端 / 重启都不会停
  · 数据在 $APP_DIR/db/douyin.db，备份它即可
EOT

if [ "$CONFIG_NEW" = "1" ]; then
  warn "config.yaml 是刚生成的，cookie 还是空的 —— 采集不到数据！"
  echo "     编辑 $APP_DIR/config.yaml 填入 cookie，然后："
  echo "       sudo systemctl restart $SERVICE"
fi
