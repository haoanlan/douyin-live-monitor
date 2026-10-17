# =============================================================================
# 抖音直播监控（douyin-live）多阶段镜像
#
#   看板/后端：Node 22（开发机为 22.12.0）+ better-sqlite3 + ws + playwright(仅包)
#   前端：Vue3 + Vite，构建产物 frontend/dist 由 builder 生成，不进构建上下文
#   抓取端：Go 代理 jwwsjlm/douyinLive v2.3.1（Linux amd64，构建时下载）
#
# 构建：
#   docker build -t douyinlive:v2.3.1 .
#   docker compose build && docker compose up -d
#
# 代理下载（重要）：
#   默认走 github.com 的 release 地址。构建机必须能访问 github.com；
#   若不通，用 --build-arg PROXY_BINARY_URL=... 指向可达的镜像/内网地址，例如：
#     docker build --build-arg PROXY_BINARY_URL=https://your-mirror/proxy.tar.gz -t douyinlive:v2.3.1 .
#   PROXY_BINARY_URL 既可以指向 .tar.gz/.tgz（自动解包、找 douyinLive* 并改名为
#   douyinLive-linux-amd64），也可以直接指向未压缩的 Linux amd64 可执行文件。
#   可选 PROXY_BINARY_SHA256=<64位小写hex> 在解包前校验下载内容。
#
# 原生模块（better-sqlite3）取舍：
#   A. 在 runtime 里 npm ci：镜像要带 gcc/g++/python3/make，体积大且没必要；
#   B. 单独的 deps 阶段（本文件采用）：装编译工具链后 npm ci --omit=dev，
#      再把整份 node_modules 拷进 runtime。better-sqlite3 优先下载与 Node 22 匹配的
#      预编译包（prebuild-install，走 github.com）；拿不到预编译包时自动用
#      node-gyp 从源码编译，所以工具链必须留在 deps 阶段。
#      runtime 与 deps 都基于同一 Debian bookworm + 同一 Node 版本，ABI/glibc 一致，
#      拷贝 node_modules 是安全的（镜像里另有构建期 smoke test 验证 require 可用）。
#
# 不包含 Playwright 浏览器：
#   playwright 是根依赖（图片报告/扫码登录用），但 Chromium 体积约 300MB+，默认
#   用 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 跳过。看板/抓取/报表数据不受影响；
#   “图片报告”和“扫码登录”需要浏览器，届时可在容器里手动 `npx playwright install
#   --with-deps chromium`（或自行构建带浏览器的镜像）。
# =============================================================================

ARG NODE_VERSION=22.12.0

# -----------------------------------------------------------------------------
# 1) 前端构建：npm ci + npm run build（build = gen-icon-subset + vue-tsc + vite build）
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS frontend-build

WORKDIR /build

# 先只拷 lockfile，依赖层可缓存；前端仓库里是 package-lock.json（没有 pnpm-lock.yaml），
# 所以统一用 npm 而不是 pnpm。
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend --no-audit --no-fund

# 全量前端源码（.dockerignore 已排除 frontend/node_modules、frontend/dist、
# *.tsbuildinfo，避免把宿主机的产物/增量缓存带进镜像）
COPY frontend/ ./frontend/
# frontend/package.json 的 build 脚本会执行 `node ../scripts/gen-icon-subset.cjs`
COPY scripts/gen-icon-subset.cjs ./scripts/gen-icon-subset.cjs

RUN npm run build --prefix frontend \
    && test -f /build/frontend/dist/index.html

# -----------------------------------------------------------------------------
# 2) 后端生产依赖：带编译工具链，编译/预编译 better-sqlite3 后整份 node_modules 带走
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS node-deps

WORKDIR /build

# better-sqlite3 没有匹配的预编译包时 node-gyp 需要这些；python3 是 node-gyp 的依赖
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# 只装运行依赖（playwright 包本身要装，但不要下载浏览器）
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

# 构建期 smoke test：确认原生模块与当前 Node ABI 匹配，坏镜像不要留到运行期才发现
RUN node -e "const Database=require('better-sqlite3'); const d=new Database(':memory:'); d.exec('create table t(x)'); d.close(); console.log('better-sqlite3 OK')"

# -----------------------------------------------------------------------------
# 3) Go 抓取代理：下载 release 资产并统一命名/加执行位
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS proxy-download

# 默认 v2.3.1 Linux amd64 资产（12.5MB）。可用 --build-arg 覆盖。
# 注意：本机 github.com 直连不通，无法在本机实测该地址；构建机需能访问 github.com。
ARG PROXY_BINARY_URL=https://github.com/jwwsjlm/douyinLive/releases/download/v2.3.1/douyinLive-v2.3.1-0e506f3cf935-linux-amd64.tar.gz
# 默认资产的 SHA256（来自 GitHub Release API 的 digest）。
# 换用镜像/自己重打包的资产时，请把这里改成对应哈希；如果确实不想校验，传空字符串即可：
#   docker build --build-arg PROXY_BINARY_SHA256= ...
ARG PROXY_BINARY_SHA256=85d735e62468a8a3db956cd9bf978bc1fc79fd276632428583d666506738a456

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# release 里真实文件名不固定（官方 tar.gz 内通常是 douyinLive），这里统一找
# douyinLive* 并落到后端约定的 douyinLive-linux-amd64；也允许 URL 直接指向裸二进制。
# 最后校验 ELF 头，避免把 HTML 错误页/空文件当二进制打进镜像。
RUN set -eux; \
    mkdir -p /out; \
    curl -fL --retry 5 --retry-delay 2 --connect-timeout 20 \
         -o /tmp/proxy.download "$PROXY_BINARY_URL"; \
    if [ -n "$PROXY_BINARY_SHA256" ]; then \
      printf '%s  %s\n' "$PROXY_BINARY_SHA256" /tmp/proxy.download | sha256sum -c -; \
    fi; \
    case "$PROXY_BINARY_URL" in \
      *.tar.gz|*.tgz) \
        tar -xzf /tmp/proxy.download -C /out; \
        bin="$(find /out -type f -name 'douyinLive*' | head -n 1)"; \
        if [ -z "$bin" ]; then \
          bin="$(find /out -type f -perm /111 | head -n 1)"; \
        fi; \
        if [ -z "$bin" ]; then \
          echo 'ERROR: 归档里没有找到 douyinLive* 文件，归档内容如下：' >&2; \
          tar -tzf /tmp/proxy.download >&2; \
          exit 1; \
        fi; \
        install -m 0755 "$bin" /out/douyinLive-linux-amd64 ;; \
      *) \
        install -m 0755 /tmp/proxy.download /out/douyinLive-linux-amd64 ;; \
    esac; \
    od -An -tx1 -N4 /out/douyinLive-linux-amd64 | tr -d ' \n' | grep -qx '7f454c46'; \
    rm -f /tmp/proxy.download

# -----------------------------------------------------------------------------
# 4) 运行时镜像
# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

# 时区（日志、SQLite datetime('now','localtime') 都依赖它）。
# DASHBOARD_HOST 必须绑 0.0.0.0，否则容器外无法访问 9871（config.yaml 里默认是 127.0.0.1）。
ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    DASHBOARD_HOST=0.0.0.0 \
    DASHBOARD_PORT=9871

# tzdata: TZ 生效；lsof: 看板“重启 Go 代理”用 lsof 找 1088 的监听进程；ca-certificates: HTTPS
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata lsof \
    && ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime \
    && echo "$TZ" > /etc/timezone \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# node:22 镜像自带 node 用户（uid/gid 1000）；沿用它做非 root 运行。
# 如果宿主机 ./db、./logs 的属主不是 1000，请先 chown（见 docker-compose.yml 注释）。
COPY --from=node-deps --chown=node:node /build/node_modules ./node_modules
COPY --from=frontend-build --chown=node:node /build/frontend/dist ./frontend/dist
COPY --from=proxy-download --chown=node:node /out/douyinLive-linux-amd64 ./douyinLive-linux-amd64

# 后端源码。只拷运行需要的文件，不带 scripts/、test/、docs/、db/、logs/。
COPY --chown=node:node package.json package-lock.json config.example.yaml favicon.svg ./
COPY --chown=node:node \
     web-dashboard.js monitor.js db-sqlite.js report-image.js feishu-send.js \
     douyin-user.js thanks-rank.js thanks-rank-diamonds.js merge-sessions.js \
     query-user-gifts.js sync-gift-icons.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node assets ./assets

# db/、logs/ 是挂载点；镜像内先建好目录并保证 node 用户可写（无挂载时也能启动）。
# streamers/、current_sessions/ 是 worker 运行时创建的目录，这里预建避免首启权限问题。
# 关键：WORKDIR /app 由 root 创建，必须把 /app 本身也交给 node —— 运行时要往根目录写
# proxy-config.yaml、runtime-config.json、monitor.pid、current_session.json、snapshot_*.json。
# 只 chown 目录本身与这几个子目录，避免 chown -R /app 触发整份 node_modules 的 overlay copy-up。
RUN mkdir -p /app/db /app/logs /app/streamers /app/current_sessions \
    && chown node:node /app \
    && chown -R node:node /app/db /app/logs /app/streamers /app/current_sessions \
    && chmod 0755 /app/douyinLive-linux-amd64

USER node

VOLUME ["/app/db", "/app/logs"]
EXPOSE 9871 1088

# 健康检查：只要能连上 HTTP 就算活着（未登录返回 401、SPA 路由 404 都算健康），
# 不校验状态码/响应体，避免把“需要登录”误判为不健康。
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD node -e "const http=require('http');const p=process.env.DASHBOARD_PORT||9871;const r=http.get('http://127.0.0.1:'+p+'/',{timeout:4000},s=>{s.resume();process.exit(0)});r.on('error',()=>process.exit(1));r.on('timeout',()=>{r.destroy();process.exit(1)})"

# 入口：
#   1) 没有 config.yaml 时用镜像内的 config.example.yaml 生成一份（首次启动可跑；
#      生产环境建议用 compose 把宿主机 config.yaml 挂进来，cookie 不随镜像走）
#   2) 建好 db/logs 并检查当前用户可写（bind mount 属主不对时给出明确错误）
#   3) exec 到 CMD，保证 node 是 1 号进程、能收到 SIGTERM 做优雅退出
ENTRYPOINT ["/bin/sh", "-c", "set -e; if [ -d /app/config.yaml ]; then echo \"[entrypoint] /app/config.yaml 是目录（宿主机缺少该文件时 Docker 会自动建目录）；请先在宿主机执行 cp config.example.yaml config.yaml\" >&2; exit 1; fi; [ -f /app/config.yaml ] || cp /app/config.example.yaml /app/config.yaml; mkdir -p /app/db /app/logs; for d in /app/db /app/logs; do [ -w \"$d\" ] || { echo \"[entrypoint] $d 不可写：请在宿主机执行 mkdir -p db logs && sudo chown -R 1000:1000 db logs，或用 --user 0:0 运行\" >&2; exit 1; }; done; exec \"$@\"", "--"]

# 不要设置 DASHBOARD_EMBED_WORKER=0：看板需要内嵌 worker 才会自动拉起 Go 代理
# （proxy 1088、config.yaml → proxy-config.yaml 的生成都在 worker 里）。
CMD ["node", "web-dashboard.js"]
