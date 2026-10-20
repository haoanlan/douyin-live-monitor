#!/usr/bin/env bash
# =============================================================================
# 给 douyin-live-monitor 装「扫码登录 / 图片报告」需要的浏览器环境
#
#   sudo bash deploy/install-browser.sh [安装目录，默认 /opt/douyin-monitor]
#
# 为什么需要三样东西（不是只装个浏览器就行）：
#   1) Chromium/Chrome —— 真浏览器（扫码登录有头模式；图片报告截图也用）
#   2) 系统依赖       —— libnss3 / libgbm 等，缺了浏览器直接起不来
#   3) Xvfb           —— 虚拟显示器（服务器没有屏幕，有头模式需要 DISPLAY）
#
# 装完会做一次真实测试：用无头浏览器 + Xvfb 打开页面并截图。
# =============================================================================
set -euo pipefail

APP_DIR="${1:-/opt/douyin-monitor}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[失败] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$EUID" -eq 0 ] || die "请用 sudo 运行：sudo bash deploy/install-browser.sh"
command -v apt-get >/dev/null || die "只支持 Debian / Ubuntu"

say "1/4 安装 Chromium 与系统依赖"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  chromium xvfb fonts-noto-cjk fonts-noto-color-emoji \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2t64 2>/dev/null \
 || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  chromium xvfb fonts-noto-cjk fonts-noto-color-emoji \
  libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
  libgbm1 libpango-1.0-0 libcairo2 libasound2

CHROME=""
for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
  [ -x "$c" ] && CHROME="$c" && break
done
[ -n "$CHROME" ] || die "装完仍找不到 chromium（/usr/bin/chromium）"
ok "浏览器: $CHROME"
ok "Xvfb:   $(command -v Xvfb)"

say "2/4 验证浏览器能启动（无头模式）"
"$CHROME" --headless=new --no-sandbox --disable-gpu --dump-dom about:blank >/dev/null 2>&1 \
  && ok "无头启动 OK" || warn "无头启动失败（可能缺库，继续看第 4 步测试）"

say "3/4 验证 Xvfb（有头模式需要的虚拟屏幕）"
Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 &
XPID=$!
sleep 2
if DISPLAY=:99 "$CHROME" --no-sandbox --disable-gpu --dump-dom about:blank >/dev/null 2>&1; then
  ok "有头模式（DISPLAY=:99）启动 OK"
else
  warn "有头模式启动失败，见 /tmp/xvfb.log 与下面的测试"
fi
kill $XPID 2>/dev/null || true

say "4/4 用真实页面测一次（Playwright 打开并截图）"
mkdir -p /tmp/browser-test
( cd "$APP_DIR" && xvfb-run -a node -e '
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch({
    headless: false,                       // 扫码登录要求有头；xvfb-run 提供虚拟屏
    executablePath: process.env.CHROME_PATH || undefined,
    args: ["--no-sandbox", "--disable-gpu"]
  });
  const p = await b.newPage();
  await p.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
  await p.screenshot({ path: "/tmp/browser-test/douyin.png" });
  console.log("页面标题:", await p.title());
  await b.close();
  console.log("SCREENSHOT_OK");
})().catch((e) => { console.error("TEST_FAIL:", e.message); process.exit(1); });
' ) && ok "测试通过：/tmp/browser-test/douyin.png" \
   || warn "测试未通过 —— 若上面第 3 步正常，多半是 Playwright 自带的 chromium 没装，见下"

cat <<'EOT'

------------------------------------------------------------------
接下来（把浏览器告诉应用）

systemd 部署：编辑服务，加上三行环境变量
  sudo systemctl edit douyin-live
    [Service]
    Environment=DOUYIN_LOGIN_BROWSER=/usr/bin/chromium
    Environment=DISPLAY=:99
    Environment=PLAYWRIGHT_BROWSERS_PATH=/opt/douyin-monitor/.pw-browsers

  但 DISPLAY=:99 需要有一个常驻 Xvfb，推荐用 systemd 单元托管：
  sudo tee /etc/systemd/system/xvfb.service >/dev/null <<'EOF2'
[Unit]
Description=Xvfb virtual display :99
After=network.target
[Service]
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x800x24
Restart=always
[Install]
WantedBy=multi-user.target
EOF2
  sudo systemctl daemon-reload && sudo systemctl enable --now xvfb
  sudo systemctl restart douyin-live

Docker 部署：镜像里已带（构建时 WITH_PLAYWRIGHT=1），但**必须有 Xvfb**：
  在 compose 里加 `command` 用 xvfb-run 启动，或基于本脚本思路改 Dockerfile。

1Panel 的「Node 运行环境」容器：**不推荐**用于扫码登录 ——
  容器重建会丢掉 chromium/xvfb；要用就选 Docker 镜像路线。
------------------------------------------------------------------
EOT
