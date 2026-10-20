#!/usr/bin/env bash
# =============================================================================
# 为「扫码登录」配置有头浏览器 + 虚拟屏（Xvfb）
#
#   sudo bash deploy/setup-xvfb.sh [应用目录] [服务名]
#   默认：/opt/douyin-monitor  douyin-live
#
# 前置：chromium 已安装（没装先跑 deploy/install-browser.sh）
#
# 它做四件事（不是"告诉你该做什么"，而是**直接改好**）：
#   1) 装 xvfb
#   2) 写一个常驻的 xvfb.service（:99，开机自启）
#   3) 给应用服务加 systemd drop-in：DISPLAY / DOUYIN_LOGIN_BROWSER / PLAYWRIGHT_BROWSERS_PATH
#   4) 重启并实测「有头 chromium 在 :99 上能开」
# =============================================================================
set -euo pipefail

APP_DIR="${1:-/opt/douyin-monitor}"
SERVICE="${2:-douyin-live}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[失败] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$EUID" -eq 0 ] || die "请用 sudo 运行"
command -v apt-get >/dev/null || die "只支持 Debian / Ubuntu"
[ -d "$APP_DIR" ] || die "应用目录不存在：$APP_DIR"
systemctl list-unit-files | grep -q "^${SERVICE}.service" || warn "没找到 ${SERVICE}.service，drop-in 会先建好，服务起来后自动生效"

say "1/4 安装 xvfb"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb >/dev/null
ok "Xvfb: $(command -v Xvfb)"

CHROME=""
for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
  [ -x "$c" ] && CHROME="$c" && break
done
[ -n "$CHROME" ] || die "没找到 chromium —— 先跑 sudo bash deploy/install-browser.sh"
ok "浏览器: $CHROME"

say "2/4 常驻虚拟屏 xvfb.service（DISPLAY=:99）"
cat > /etc/systemd/system/xvfb.service <<'EOF'
[Unit]
Description=Xvfb virtual display :99 (for headed browser)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x900x24 -nolisten tcp
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now xvfb >/dev/null 2>&1
ok "xvfb 已启动并设为开机自启"

say "3/4 给 ${SERVICE}.service 加 drop-in"
mkdir -p "/etc/systemd/system/${SERVICE}.service.d"
cat > "/etc/systemd/system/${SERVICE}.service.d/browser.conf" <<EOF
# 由 deploy/setup-xvfb.sh 生成：让扫码登录能用到有头浏览器
[Service]
Environment=DISPLAY=:99
Environment=DOUYIN_LOGIN_BROWSER=${CHROME}
Environment=PLAYWRIGHT_BROWSERS_PATH=${APP_DIR}/.pw-browsers
EOF
systemctl daemon-reload
ok "写入 /etc/systemd/system/${SERVICE}.service.d/browser.conf"

systemctl restart "$SERVICE" >/dev/null 2>&1 || warn "重启 ${SERVICE} 失败，稍后手动看日志"
sleep 3
systemctl is-active --quiet "$SERVICE" && ok "${SERVICE} 正在运行" || warn "${SERVICE} 未运行，见 journalctl -u ${SERVICE}"

say "4/4 实测：有头 chromium 在 :99 上能否打开页面"
rm -rf /tmp/cr-headed-test
DISPLAY=:99 timeout 10 "$CHROME" --no-sandbox --disable-gpu \
  --user-data-dir=/tmp/cr-headed-test about:blank >/tmp/cr-headed.log 2>&1 || true
if grep -qiE "missing x server|cannot open display|no display" /tmp/cr-headed.log; then
  die "有头模式仍失败：$(grep -iE 'missing|display' /tmp/cr-headed.log | head -1)"
fi
ok "有头模式启动成功（无显示器报错）"
ok "DISPLAY=:99 已通过 xvfb 提供"

cat <<EOT

------------------------------------------------------------------
已完成。现在去页面里点「扫码登录」，应该能出二维码了。

如果还报「找不到可用的浏览器」：
  sudo systemctl show ${SERVICE} -p Environment | tr ' ' '\n' | grep -E 'DISPLAY|DOUYIN_LOGIN_BROWSER'
  应能看到 DISPLAY=:99 与 DOUYIN_LOGIN_BROWSER=$CHROME

如果二维码空白 / 加载不出来：
  sudo journalctl -u ${SERVICE} -n 80 --no-pager
  tail -50 /tmp/cr-headed.log

浏览器进程卡住的检查：
  ps aux | grep -E 'Xvfb|chrom' | grep -v grep
  DISPLAY=:99 xdpyinfo | head -5      # 需要 x11-utils；能输出屏幕信息就说明虚拟屏正常
------------------------------------------------------------------
EOT
