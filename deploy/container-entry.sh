#!/bin/sh
# =============================================================================
# 1Panel「Node 运行环境」—— 一键入口（安装 + 启动，全部包办）
#
#   1Panel → 运行环境 → 启动命令只填这一行：
#     bash /opt/douyin-monitor/deploy/container-entry.sh
#
# 首次启动会自动做（后续启动会跳过，秒过）：
#   · apt 安装 xvfb（虚拟屏，扫码登录的有头浏览器需要）
#   · 把 chromium 下到项目目录 .pw-browsers（挂载出来的，重建容器也不丢）
#   · 起 Xvfb :99 并 export DISPLAY
#   · exec node web-dashboard.js（node 成为容器主进程）
#
# 不需要你手动进容器装任何东西。
# =============================================================================
set -eu

cd "$(dirname "$0")/.."

# 代理二进制：zip 不保留 Unix 执行位，解压出来是 644 -> spawn 会 EACCES。
# 这里每次启动都补一次，避免"重建容器后采集起不来"。
if [ -f "$(pwd)/douyinLive-linux-amd64" ]; then chmod +x "$(pwd)/douyinLive-linux-amd64" 2>/dev/null || true; fi
echo "[entry] 工作目录: $(pwd)"

warn() { printf '\033[1;33m[entry] 警告: %s\033[0m\n' "$*" >&2; }
info() { printf '\033[1;36m[entry] %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# 1) Xvfb（系统包，只能 apt —— 这里只在缺失时装一次）
# ---------------------------------------------------------------------------
if ! command -v Xvfb >/dev/null 2>&1; then
  info "首次启动：安装 xvfb（约 10 秒）..."
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb >/dev/null 2>&1 \
      || warn "xvfb 安装失败（扫码登录会不可用，其余功能正常）"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache xvfb >/dev/null 2>&1 || warn "xvfb 安装失败"
  else
    warn "没有 apt/apk，无法安装 xvfb"
  fi
fi

# ---------------------------------------------------------------------------
# 2) Chromium（下到项目目录，持久化；Playwright 的库已在 package.json 里）
# ---------------------------------------------------------------------------
export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.pw-browsers"
if [ ! -d "$PLAYWRIGHT_BROWSERS_PATH/chromium-"* ] 2>/dev/null; then
  if ! ls -d "$PLAYWRIGHT_BROWSERS_PATH"/chromium-* >/dev/null 2>&1; then
    info "首次启动：下载 chromium 到 .pw-browsers（约 150MB，3-5 分钟）..."
    npx playwright install --with-deps chromium \
      || warn "chromium 下载失败（图片报告/扫码登录会不可用）"
  fi
fi
info "PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"

# ---------------------------------------------------------------------------
# 2.5) chromium 的系统依赖（每次启动都查，缺了才装）
#
# 为什么必须单独查：上面那段只在".pw-browsers 里没有浏览器"时才跑 --with-deps，
# 而浏览器是持久化在项目目录里的 —— 容器重建后浏览器还在，系统库（libnspr4 /
# libnss3 等，装进容器层）却全没了，于是 Chrome 一启动就
#   error while loading shared libraries: libnspr4.so: cannot open shared object file
# Playwright 只报 "Target page, context or browser has been closed"，极难定位。
# ---------------------------------------------------------------------------
CH_BIN="$(ls -d "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1)"
if [ -n "$CH_BIN" ]; then
  MISSING_LIBS=""
  if command -v ldd >/dev/null 2>&1; then
    MISSING_LIBS="$(ldd "$CH_BIN" 2>/dev/null | grep 'not found' || true)"
  fi
  if [ -n "$MISSING_LIBS" ]; then
    info "chromium 缺少系统库，开始安装（约 1-3 分钟，只需一次）..."
    printf '%s\n' "$MISSING_LIBS" | head -5 | while IFS= read -r line; do warn "  缺: $line"; done
    if command -v apt-get >/dev/null 2>&1; then
      # Playwright 自己知道完整依赖集；失败再退回手写清单
      npx playwright install-deps chromium >/tmp/pw-deps.log 2>&1 \
        || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
             libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
             libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
             libgbm1 libpango-1.0-0 libcairo2 libasound2 >>/tmp/pw-deps.log 2>&1 \
        || warn "系统库安装失败，见 /tmp/pw-deps.log（扫码登录会不可用，其余功能正常）"
    else
      warn "没有 apt-get，无法自动安装 chromium 依赖"
    fi
    if ! ldd "$CH_BIN" 2>/dev/null | grep -q 'not found'; then
      info "系统库已补齐 ✓"
    fi
  else
    info "chromium 系统库完整 ✓"
  fi
fi

# ---------------------------------------------------------------------------
# 3) 起虚拟屏
# ---------------------------------------------------------------------------
DISPLAY_NUM="${XVFB_DISPLAY:-99}"
if command -v Xvfb >/dev/null 2>&1; then
  if [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ]; then
    info "虚拟屏 :${DISPLAY_NUM} 已存在，复用"
  else
    info "启动 Xvfb :${DISPLAY_NUM}"
    Xvfb ":${DISPLAY_NUM}" -screen 0 1280x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
    for _ in $(seq 1 25); do
      [ -e "/tmp/.X11-unix/X${DISPLAY_NUM}" ] && break
      sleep 0.2
    done
  fi
  export DISPLAY=":${DISPLAY_NUM}"
  info "DISPLAY=${DISPLAY}"
else
  warn "没有 Xvfb —— 扫码登录会报「找不到可用的浏览器」"
fi

# ---------------------------------------------------------------------------
# 4) 告诉应用用哪个浏览器
# ---------------------------------------------------------------------------
for c in /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome /usr/bin/google-chrome-stable; do
  if [ -x "$c" ]; then
    export DOUYIN_LOGIN_BROWSER="$c"
    info "DOUYIN_LOGIN_BROWSER=$c"
    break
  fi
done

# ---------------------------------------------------------------------------
# 5) 启动（exec 让 node 成为容器主进程）
# ---------------------------------------------------------------------------
info "启动 node web-dashboard.js"
exec node web-dashboard.js
