#!/usr/bin/env bash
# =============================================================================
# 构建「运行环境镜像」——把浏览器依赖 / 字体 / Xvfb 烘进镜像，重启不再重装
#
#   bash deploy/build-runtime-image.sh [镜像名:tag]
#
# 背景：1Panel「Node 运行环境」每次启动是按镜像**重建容器**，
# apt 装进容器层的东西（fonts-noto-cjk / libnss3 / xvfb）重启就没了，
# 所以每次都要重装 1-3 分钟。把依赖烘进镜像后，重启即秒起。
# =============================================================================
set -euo pipefail

IMAGE="${1:-douyin-monitor-runtime:$(date +%Y%m%d)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }

command -v docker >/dev/null || { echo "没有 docker，无法构建镜像" >&2; exit 1; }

say "构建镜像 $IMAGE"
docker build -f "$HERE/Dockerfile.runtime" -t "$IMAGE" "$HERE"

say "自检：字体与浏览器依赖是否都在镜像里"
docker run --rm "$IMAGE" bash -lc '
  echo "--- 字体 ---"
  fc-list | grep -Ei "noto.*cjk|hanazono" | head -5 || echo "字体缺失!"
  echo "--- 关键库 ---"
  for lib in libnss3.so libnspr4.so libgbm.so.1 libasound.so.2; do
    found=$(ldconfig -p 2>/dev/null | grep -c "$lib" || true)
    printf "%-16s %s\n" "$lib" "$([ "$found" -gt 0 ] && echo ok || echo MISSING)"
  done
  echo "--- Xvfb ---"
  command -v Xvfb >/dev/null && echo ok || echo MISSING
'

ok "镜像已就绪：$IMAGE"
cat <<EOF

下一步（1Panel）：
  1) 运行环境 → 你的应用 → 编辑
  2) 镜像改成：$IMAGE
  3) 挂载目录保持不变（项目目录仍然挂到容器里，代码走挂载，不进镜像）
  4) 保存并重启 —— 之后重启不会再装字体/浏览器依赖

验证（可选）：
  docker run --rm $IMAGE bash -lc 'fc-list | grep -ci cjk; ldd --version | head -1'
EOF
