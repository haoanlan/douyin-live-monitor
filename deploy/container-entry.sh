#!/usr/bin/env bash
# =============================================================================
# 1Panel「Node 运行环境」容器用的启动入口
#
#   1Panel → 运行环境 → 启动命令改为：
#     bash /opt/douyin-monitor/deploy/container-entry.sh
#
# 作用：
#   · 起一个虚拟屏 Xvfb :99（扫码登录的有头浏览器需要）
#   · 把 node 提升为容器主进程（exec），这样 1Panel 的日志/停止/重启才正常
#
# 前置（在容器里装一次，重启容器不会丢）：
#   apt-get update && apt-get install -y xvfb
#   cd /opt/douyin-monitor && npx playwright install --with-deps chromium
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."     # 项目根目录
echo "[entry] 工作目录: $(pwd)"

DISPLAY_NUM="${XVFB_DISPLAY:-99}"

if command -v Xvfb >/dev/null 2>&1; then
  # 已有同号显示就不再起（重启脚本时不会叠一堆）
  if [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; then
    echo "[entry] 虚拟屏 :${DISPLAY_NUM} 已存在，复用"
  else
    echo "[entry] 启动 Xvfb :${DISPLAY_NUM}"
    Xvfb ":${DISPLAY_NUM}" -screen 0 1280x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
    for _ in $(seq 1 20); do
      [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ] && break
      sleep 0.2
    done
  fi
  export DISPLAY=":${DISPLAY_NUM}"
  echo "[entry] DISPLAY=${DISPLAY}"
else
  echo "[entry] 警告：容器内没有 Xvfb —— 扫码登录会报「找不到可用的浏览器」" >&2
  echo "[entry]       安装：apt-get update && apt-get install -y xvfb" >&2
fi

# 浏览器位置（install 时装进项目目录，容器重建也不丢）
if [ -d "$(pwd)/.pw-browsers" ]; then
  export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.pw-browsers"
  echo "[entry] PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"
fi

# 显式指定浏览器（找到哪个用哪个）
for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
  if [ -x "$c" ]; then
    export DOUYIN_LOGIN_BROWSER="$c"
    echo "[entry] DOUYIN_LOGIN_BROWSER=$c"
    break
  fi
done

echo "[entry] 启动 node web-dashboard.js"
exec node web-dashboard.js
