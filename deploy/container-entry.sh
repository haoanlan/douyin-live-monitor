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
# 0) 时区（必须在 node 启动前设好）
#
# 代码里有 10+ 处 SQL 用 `strftime(..., 'localtime')`（日期分组、小时分布、
# 弹幕时间轴、单价更新时间…）。SQLite 的 'localtime' 取的是**进程 TZ**：
#   · TZ 设成 Asia/Shanghai → 北京时间 ✓
#   · TZ 没设、容器又是 UTC 基础镜像 → 全部偏 8 小时 ✗ 而且**不报错** ✗
# 所以这里显式固化；外部已经设了 TZ 就尊重外部（不覆盖）。
# ---------------------------------------------------------------------------
export TZ="${TZ:-Asia/Shanghai}"
if [ "$TZ" = "Asia/Shanghai" ] || [ "$TZ" = "PRC" ] || [ "$TZ" = "CST-8" ]; then
  info "时区: $TZ（北京时间 ✓）"
else
  warn "时区是 $TZ —— 代码里的日期/小时统计都按它算，不是北京时间；要改就设 TZ=Asia/Shanghai"
fi

# ---------------------------------------------------------------------------
# 0.5) 依赖自检：**每次启动实测，不再信任标记文件**
#
# 原来是"装成功一次就写 .runtime-deps-ok，下次看到文件就跳过"。这个做法有两个洞：
#   1) 写入失败被 `|| true` 吞掉 → 明明没记下来，下次还是全量重装（用户看到的"每次重启都装"）；
#   2) 反过来，标记一旦过期（容器按镜像重建、apt 装进容器层的字体/库已经没了，
#      但标记文件在挂载盘上还在）→ 脚本会**跳过安装**，字库真丢了却不补，图片里全是"口口口"。
# 现在改成每次启动花 10 毫秒实测三件事：Xvfb 命令在不在、字体文件在不在项目目录、
# chromium 的系统库（ldd）缺不缺。都齐就跳过安装；缺什么装什么。
# ---------------------------------------------------------------------------
export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.pw-browsers"

# 字体落在项目目录（挂载盘）里，和 node_modules / .pw-browsers 同一个待遇：
# 容器按镜像重建也不丢，所以"装一次"就真的只装一次。
export RUNTIME_FONT_DIR="$(pwd)/.runtime-fonts"
RUNTIME_FONT_CONF="$RUNTIME_FONT_DIR/fonts.conf"
RUNTIME_FONT_CACHE="$RUNTIME_FONT_DIR/cache"

font_count() {
  ls "$RUNTIME_FONT_DIR"/*.ttf "$RUNTIME_FONT_DIR"/*.ttc "$RUNTIME_FONT_DIR"/*.otf 2>/dev/null | wc -l | tr -d ' '
}
chromium_bin() {
  ls -d "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux64/chrome 2>/dev/null | head -1
}

DEPS_READY=0
DEPS_WHY="未知"
if [ "${SKIP_DEPS:-0}" = "1" ] || [ "${DY_RUNTIME_IMAGE:-0}" = "1" ]; then
  DEPS_READY=1
  DEPS_WHY="由镜像提供（SKIP_DEPS / DY_RUNTIME_IMAGE）"
elif ! command -v Xvfb >/dev/null 2>&1; then
  DEPS_WHY="缺 Xvfb"
elif [ "$(font_count)" -lt 1 ]; then
  DEPS_WHY="字体还没落到项目目录"
else
  CH_BIN_NOW="$(chromium_bin)"
  if [ -n "$CH_BIN_NOW" ] && command -v ldd >/dev/null 2>&1 \
     && ldd "$CH_BIN_NOW" 2>/dev/null | grep -q 'not found'; then
    DEPS_WHY="chromium 缺系统库"
  else
    DEPS_READY=1
    DEPS_WHY="Xvfb + 字体 + 系统库都在"
  fi
fi
if [ "$DEPS_READY" = "1" ]; then
  info "依赖已就绪（$DEPS_WHY），跳过安装"
else
  info "依赖需要补齐：$DEPS_WHY"
fi

# ---------------------------------------------------------------------------
# 1) Xvfb（系统包，只能 apt —— 这里只在缺失时装一次）
# ---------------------------------------------------------------------------
if [ "$DEPS_READY" = "0" ] && ! command -v Xvfb >/dev/null 2>&1; then
  info "检测到缺少 Xvfb"
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
#
# 原来这里的判断是 `[ ! -d "$PLAYWRIGHT_BROWSERS_PATH/chromium-"* ]`：
# 通配符展开成多个参数时 test 会直接报 "too many arguments"（被 2>/dev/null 吞掉），
# 判断结果不可靠。改成统一走 chromium_bin()（ls 到可执行文件才算真装了）。
# ---------------------------------------------------------------------------
if [ -z "$(chromium_bin)" ]; then
  info "首次启动：下载 chromium 到 .pw-browsers（约 150MB，3-5 分钟）..."
  npx playwright install --with-deps chromium \
    || warn "chromium 下载失败（图片报告/扫码登录会不可用）"
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
CH_BIN="$(chromium_bin)"
if [ "$DEPS_READY" = "0" ] && [ -n "$CH_BIN" ]; then
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
# 2.6) 中日韩字体：**放进项目目录，和 node_modules 一样持久**
#
# 为什么不再 apt install：1Panel 重启 Node 运行环境是**按镜像重建容器**，
# apt 装进容器层的字体每次清零，于是每次启动都要重装 1-2 分钟（用户反馈的正是这条）。
# 字体本质就是几个文件 —— 放进项目目录（挂载盘）就"装一次、永久有效"，
# 再用 FONTCONFIG_FILE 把 fontconfig 指过去，Chromium 直接读这个文件夹。
#
# 取文件的顺序（都不需要 root，也不往容器层写东西）：
#   1) 系统里已经有（自定义镜像 / 之前 apt 装过）→ 复制进项目目录，不走网络
#   2) 没有就 `apt-get download` 下 deb 到 /tmp，再 `dpkg-deb -x` 把 ttf/ttc/otf 解进项目目录
#   3) 都失败 → 只 warn，不阻塞启动（图片里的生僻字会变方块）
#
# 需要覆盖的生僻字：CJK 扩展 B 区（如 𠈌 𤫊 𣲙，U+2020C / U+24ACA / U+23C99）。
#   fonts-noto-cjk  覆盖日常中文
#   fonts-hanazono  覆盖 CJK 扩展 A/B/C/D，是这类生僻字的关键
# ---------------------------------------------------------------------------
FONTS_ADDED=0
mkdir -p "$RUNTIME_FONT_DIR" 2>/dev/null || true
if [ "$(font_count)" -lt 1 ]; then
  info "首次启动：把中文字体落到 $RUNTIME_FONT_DIR（之后不再安装）..."
  for d in /usr/share/fonts/opentype/noto /usr/share/fonts/truetype/hanazono /usr/share/fonts/truetype/noto; do
    [ -d "$d" ] || continue
    for f in "$d"/*CJK* "$d"/*.ttf "$d"/*.ttc "$d"/*.otf; do
      [ -f "$f" ] || continue
      if cp -f "$f" "$RUNTIME_FONT_DIR/" 2>/dev/null; then FONTS_ADDED=1; fi
    done
  done
  if [ "$(font_count)" -lt 1 ] && command -v apt-get >/dev/null 2>&1 && command -v dpkg-deb >/dev/null 2>&1; then
    FONT_TMP="$(mktemp -d)"
    (
      cd "$FONT_TMP" || exit 0
      apt-get -o Dir::State::lists="$FONT_TMP/lists" update -qq >/dev/null 2>&1 || true
      apt-get -o Dir::State::lists="$FONT_TMP/lists" download fonts-noto-cjk fonts-hanazono >/dev/null 2>&1 || true
    )
    for deb in "$FONT_TMP"/*.deb; do
      [ -f "$deb" ] || continue
      dpkg-deb -x "$deb" "$FONT_TMP/root" 2>/dev/null || true
    done
    if [ -d "$FONT_TMP/root" ]; then
      find "$FONT_TMP/root" -type f \( -name '*.ttf' -o -name '*.ttc' -o -name '*.otf' \) \
        -exec cp -f {} "$RUNTIME_FONT_DIR/" \; 2>/dev/null || true
      FONTS_ADDED=1
    fi
    rm -rf "$FONT_TMP" 2>/dev/null || true
  fi
  if [ "$(font_count)" -lt 1 ]; then
    warn "字体没取到（网络或 apt 源问题）——图片里的中文可能显示成方块，但服务照常启动"
  fi
fi

# fontconfig：先 include 系统默认配置（保留 emoji 等系统字体），再追加项目目录
if ! grep -qF "$RUNTIME_FONT_DIR" "$RUNTIME_FONT_CONF" 2>/dev/null; then
  mkdir -p "$RUNTIME_FONT_CACHE" 2>/dev/null || true
  cat > "$RUNTIME_FONT_CONF" <<FONTCONF
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>
  <dir>${RUNTIME_FONT_DIR}</dir>
  <cachedir>${RUNTIME_FONT_CACHE}</cachedir>
</fontconfig>
FONTCONF
  FONTS_ADDED=1
fi

if [ -f "$RUNTIME_FONT_CONF" ]; then
  export FONTCONFIG_FILE="$RUNTIME_FONT_CONF"
  # 只在"这次真的加了文件/刚写配置"时重建缓存；缓存本身也存在项目目录里，
  # 所以后续启动不用再扫（启动保持秒级，而不是每次 1-2 秒的 fc-cache）
  if [ "$FONTS_ADDED" = "1" ] && command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f >/dev/null 2>&1 || true
  fi
  info "字体目录: $RUNTIME_FONT_DIR（$(font_count) 个文件），FONTCONFIG_FILE=$FONTCONFIG_FILE"
else
  warn "字体配置写不进去（$RUNTIME_FONT_CONF），中文可能显示成方块"
fi

# 旧的 .runtime-deps-ok 标记文件已经**不再读取**（它过期后会静默跳过安装，反而把字库丢掉）。
# 留着不影响使用，想清掉可以直接删：rm -f "$(pwd)/.runtime-deps-ok"

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
