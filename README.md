<div align="center">

# 🎥 抖音直播监控

**多房间直播采集 + 可视化看板**

一个进程同时跑采集 worker 与 Web 看板：自动检测开播/下播，把弹幕、礼物、进场、在线人数写入本地 SQLite，
并在看板里提供场次管理、榜单、用户画像、趋势对比、多场合并与图片报告。

[![Node](https://img.shields.io/badge/Node-%E2%89%A520.19-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Vue](https://img.shields.io/badge/Vue-3-42b883?logo=vuedotjs&logoColor=white)](#)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003b57?logo=sqlite&logoColor=white)](#)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](#-方式三dockerlinux-推荐)
[![License](https://img.shields.io/badge/License-MIT-green)](./LICENSE)
[![Release](https://img.shields.io/badge/Release-v1.2.7-blue)](https://github.com/haoanlan/douyin-live-monitor/releases)

> ⚠️ **声明**：仅供学习与研究。请遵守抖音平台规则与所在地法律法规，不要用于商业或非法用途。

</div>

---

## 📑 目录

- [它是什么](#-它是什么)
- [能做什么](#-能做什么)
- [三分钟跑起来](#-三分钟跑起来) · [Windows](#-方式一windows-发布包最简单) / [源码](#-方式二源码运行) / [Docker](#-方式三dockerlinux-推荐)
- [配置](#-配置)
- [页面使用指南](#-页面使用指南)
- [项目架构](#-项目架构)
- [Docker 镜像](#-docker-镜像构建--导出--验证)
- [数据与文件](#-数据与文件)
- [常见问题](#-常见问题)
- [从旧版本升级](#-从旧版本升级)
- [给开发者 / 对接方](#-给开发者--对接方)

---

## 🎯 它是什么

| | |
| --- | --- |
| **自托管** | 数据落在本机 SQLite（`db/douyin.db`），不依赖任何云服务 |
| **自动跟踪** | 检测到开播开始采集，确认下播后归档场次并算好各级汇总 |
| **10 个页面** | 总览、房间、场次、详情、趋势、合并、查询、画像、状态、个人中心 |
| **能出图** | 单场报告、多场合并报告、按主播生成的「感谢榜」图片（14 套模板可选） |

## ✨ 能做什么

| 使用场景 | 对应页面 |
| --- | --- |
| 近期整体表现与累计数据 | **总览** |
| 直播间配置与监控开关 | **房间管理** |
| 单场完整数据与榜单 | **场次历史** → **场次详情** |
| 主播跨场次的走势对比 | **趋势分析** |
| 多场数据合并对比 | **数据合并查看** |
| 观众礼物与弹幕记录 | **信息查询** → **用户画像** |
| 采集链路与代理健康状况 | **状态监控** |
| 报告图片 / 感谢榜图片导出 | **场次详情** · **数据合并查看** 的下载入口 |

---

## 🚀 三分钟跑起来

### 先看需要什么

| 依赖 | 必须 | 说明 |
| :--- | :---: | :--- |
| **Node.js** | ✅ 20.19+ | 推荐 22.x（Windows 发布包必须 **22.x**，见下方说明） |
| **Go 抓取代理** | ✅ | 从 [douyinLive Releases](https://github.com/jwwsjlm/douyinLive/releases) 下载对应平台二进制，放到项目根目录 |
| **抖音 cookie** | ✅ | 浏览器登录抖音网页版 → F12 → Application → Cookies → 复制完整串 |
| **Chromium** | ⭕ 可选 | 只有「图片报告 / 感谢榜图片」需要。`npx playwright install chromium`，或直接用系统 Chrome / Edge |

### 🪟 方式一：Windows 发布包（最简单）

```text
1. 解压 douyin-live-<版本>-win.zip   （已内置依赖与代理，无需 npm install）
2. 复制 config.example.yaml → config.yaml，填入 cookie
3. 双击 start.bat                     （会先检查 Node 版本）
4. 打开 http://127.0.0.1:9871         默认账号 admin / 123456，请立刻改密
```

> ⚠️ **注意**：Windows 包里 `better-sqlite3` 是**原生模块**，与打包时所用 Node **大版本绑定**（当前 **Node 22**）。
> 版本不符会报 `NODE_MODULE_VERSION 127 vs 108`。`start.bat` 已做版本检查；两种修法：
> `nvm use 22`，或在包目录执行 `npm rebuild better-sqlite3`。

### 🧑‍💻 方式二：源码运行

```bash
npm install                                # 后端依赖
cd frontend && npm install && npm run build && cd ..   # 前端依赖 + 构建（含 vue-tsc 类型检查）
node web-dashboard.js                      # 启动（worker 已内嵌）→ http://127.0.0.1:9871
```

> 💡 **提示**：`npm install` 若在 `better-sqlite3` 处报 `gyp ERR`，说明当前 Node 没有预编译包。
> 装 **Node 20 LTS** 或编译工具链（Windows：VS Build Tools；Linux：`python3 make g++`），或直接用 Docker。

### 🐳 方式三：Docker（Linux 推荐）

```bash
cp config.example.yaml config.yaml      # 填 cookie
mkdir -p db logs && sudo chown -R 1000:1000 db logs
docker compose up -d --build            # 镜像默认含 Chromium（图片报告可用）
```

| 端口 | 用途 |
| :--- | :--- |
| **9871** | 看板（浏览器访问） |
| **1088** | Go 抓取代理（建议只内网访问） |

```bash
# 想要更小的镜像（不含截图能力）
WITH_PLAYWRIGHT=0 docker compose up -d --build
```

Linux 部署细节与排错见 [deploy/DEPLOY-linux.md](./deploy/DEPLOY-linux.md)。

---

## ⚙️ 配置

`config.yaml`（已在 `.gitignore`，**不要提交**）：

```yaml
cookie:
  douyin: "你的抖音登录cookie"
port: "1088"                # Go 代理端口
dashboard:
  port: "9871"
  host: "127.0.0.1"         # 需局域网/公网访问时改 0.0.0.0
```

- 直播间列表：启动后在 **房间管理** 里增删（热生效），也可改 `runtime-config.json`
- 飞书推送（可选）：环境变量 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`
- 仪表盘也可用环境变量覆盖：`DASHBOARD_HOST` / `DASHBOARD_PORT` / `DB_SQLITE_PATH`

---

## 🖥 页面使用指南

| 页面 | 主要内容 | 关键操作 |
| --- | --- | --- |
| **总览** | 累计数字卡 + 各类榜单（热门礼物、送礼榜、弹幕活跃、主播贡献、最近场次） | 点榜单行 → 进对应场次 |
| **房间管理** | 监控中的直播间列表 | 添加/改名/暂停/删除；「进详情」跳最近一场 |
| **场次历史** | 按直播间筛选的历史场次（时间/时长/礼物数/钻石） | 点任意一场 → 场次详情 |
| **场次详情** | 统计卡 + 礼物排行 + 团播主播排名 + 弹幕排行 + 词云 + 最新动态 | 点榜单里的主播 → 看「谁给他送了礼」；右上角 ⤓ = **下载榜单图片**（选模板） |
| **趋势分析** | 主播多选 + 时间范围 + 口径（按天/场次/周/月）+ 全局 KPI（含环比） | 默认**按天**；量类指标是柱状图，人数/比率是折线 |
| **数据合并查看** | 多场合并结果：总数据报告 + 三张榜单 | 「查看合并」→ 下载总报告 / **按主播下载感谢榜单** |
| **信息查询** | 昵称模糊搜索结果（弹幕、礼物、出现的场次） | 点进某人 → 用户画像 |
| **用户画像** | 按 sec_uid 聚合：送礼历史、活跃时段、常用昵称 | — |
| **状态监控** | 守护进程 / Go 代理 / WebSocket / 录制中 + 运行日志 | 采集异常先看这里 |
| **个人中心** | 账号信息 | 改密（令牌只在本次运行有效，重启需重新登录） |

<details>
<summary><b>💡 「下载榜单图片」怎么用</b></summary>

1. 进 **场次详情** → 找到「团播主播排名」→ 点某个主播 → 弹出「送出礼物的人员榜单」
2. 点标题栏右侧的 **⤓ 下载** 图标 → 内容区切换成 **模板网格**
3. 选一套模板 → 自动按它渲染并下载图片（模板清单来自渲染脚本，接口 `GET /api/rank-image/themes`）

</details>

---

---

## 🏗 项目架构

```text
浏览器 ──HTTP(9871)──► web-dashboard.js  ── 同一进程 ──┐
                        ├─ REST /api/*        (lib/routes/*)      │
                        ├─ 静态前端            (frontend/dist)     │
                        └─ 内嵌 worker         (monitor.js)        │
                              │                                    │
                              ├─ WebSocket ws://127.0.0.1:1088/ws/<room_id>
                              │        └─ douyinLive 代理（Go 二进制，1088）
                              │
                              ├─ 写库 → SQLite db/douyin.db
                              │        ├─ 明细：danmaku / gifts / members / online_records
                              │        ├─ 场次：sessions
                              │        └─ 场次结束时算好预聚合：session_*（榜单/汇总/时间线）
                              │
                              └─ 下播后 → 报告图片（Playwright 截图）· 飞书推送（可选）
```

**一个进程**承担看板与采集（worker 可独立运行）；**代理是独立 Go 进程**（1088）负责与抖音建连。
前端只通过 `/api/*` 与后端通信，构建产物 `frontend/dist` 由后端进程直接托管。

### 目录结构

| 路径 | 职责 |
| --- | --- |
| `lib/routes/` | HTTP 接口：sessions / detail / trends / combined / users / status / export |
| `lib/worker/` | 采集实现：消息解析、增量刷库、场次收尾与预聚合 |
| `lib/*.js` | 配置解析（config-reader）、浏览器路径（browser-path）等基础件 |
| `frontend/src/` | Vue 3 看板（views / components / api / store / router） |
| `frontend/dist/` | 前端构建产物（gitignore，由 `npm run build` 生成） |
| `thanks-rank.js` | 榜单图片渲染（14 套模板 → HTML → JPEG） |
| `report-image.js` | 下播报告图片 |
| `deploy/` | systemd 部署文件 + Linux 部署说明 |
| `Dockerfile` `docker-compose.yml` | 容器化部署（多阶段构建） |
| `assets/` | 榜单图片素材 |
| `test/` | 单元测试（`node:test`） |

---

## 🐳 Docker 镜像：构建 / 导出 / 验证

### 构建并启动

```bash
cp config.example.yaml config.yaml      # 填 cookie
mkdir -p db logs && sudo chown -R 1000:1000 db logs
docker compose up -d --build            # 首次：构建前端 + 编译 better-sqlite3 + 装 Chromium
docker compose ps                      # 期望 Up (healthy)，健康检查 90s 后开始
```

### 验证清单（四条）

```bash
docker compose ps                                              # 1) Up (healthy)
curl -sI  http://127.0.0.1:9871 | head -1                      # 2) HTTP/1.1 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9871/api/overview   # 3) 401
docker exec douyinlive node -e "require('playwright').chromium.launch().then(b=>{console.log('chromium OK');return b.close()})"   # 4) chromium OK
```

### 导出镜像（给离线/另一台机器用）

```bash
# 构建机
docker save douyinlive:v2.3.1 | gzip > douyin-live-image.tar.gz
ls -lh douyin-live-image.tar.gz

# 目标机（把这个 tar 和 docker-compose.yml、config.yaml 一起拷过去）
docker load -i douyin-live-image.tar.gz
docker compose up -d          # 已有镜像时不会再 build
```

### 镜像大小参考

| 构建参数 | 约计 | 用途 |
| --- | --- | --- |
| 默认（`WITH_PLAYWRIGHT=1`） | ~1.2GB | 图片报告 / 榜单图片开箱可用 |
| `WITH_PLAYWRIGHT=0` | ~800MB | 不需要截图能力时更小 |

> 排错：`docker compose logs -f douyinlive`；若报 `/app/config.yaml 是目录`，说明宿主机没有 config.yaml，
> 先 `cp config.example.yaml config.yaml` 再 `up`。


---

## 📦 数据与文件

| 路径 | 内容 | 是否入库 |
| --- | --- | :---: |
| `db/douyin.db` | SQLite 主库（WAL 模式），所有采集数据 | ❌ |
| `config.yaml` | 你的 cookie 与端口（**不要提交**） | ❌ |
| `runtime-config.json` | 直播间列表 | 本地产物 |
| `reports/` | 自动生成的报告图片 | ❌ |
| `logs/` | 运行日志 | ❌ |

---

## ❓ 常见问题

<details>
<summary><b>看板打不开 / 端口被占</b></summary>

换端口：`DASHBOARD_PORT=9872 node web-dashboard.js`，或改 `config.yaml` 的 `dashboard.port`。
</details>

<details>
<summary><b>能打开但没有数据</b></summary>

先看 **状态监控**：Go 代理是否连上、WebSocket 是否正常。代理二进制缺失时看板能起来但采不到数据。
</details>

<details>
<summary><b>cookie 失效</b></summary>

表现：状态页连接异常 / 采不到新数据。重新从浏览器复制 cookie，更新 `config.yaml` 后重启。
</details>

<details>
<summary><b>图片报告生成失败</b></summary>

多数是 Chromium 缺失或路径找不到：`npx playwright install chromium`；
程序也会优先使用系统已装的 Chrome / Edge。Docker 镜像默认已包含。
</details>

<details>
<summary><b>Docker 报 <code>/app/config.yaml</code> 是目录</b></summary>

宿主机缺少 `config.yaml` 时 Docker 会自动建同名目录。先 `cp config.example.yaml config.yaml`。
</details>

<details>
<summary><b>Docker 里 db/logs 不可写</b></summary>

容器内以 uid 1000 运行：`sudo chown -R 1000:1000 db logs`，或用 `APP_UID=$(id -u) APP_GID=$(id -g)` 覆盖。
</details>

<details>
<summary><b>npm install 在 better-sqlite3 处报 gyp 错</b></summary>

见[方式二](#-方式二源码运行)的说明：换 Node 20 LTS、装编译工具链，或改用 Docker。
</details>

---

## ⬆️ 从旧版本升级

- 数据在 `db/douyin.db`，升级代码不会动它；升级前建议备份
- `frontend/dist` 是构建产物，拉代码后需重新 `npm install && npm run build`（或用发布包自带的 dist）
- 预聚合表在**场次结束时**写入，旧场次不会自动重算

---

## 🛠 给开发者 / 对接方

| 文档 | 内容 |
| --- | --- |
| [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) | 构建/测试、数据口径、容易踩的坑 |

所有 `/api/*` 需要登录令牌：`Authorization: Bearer <token>`，返回 JSON（gzip）。

| 域 | 接口 |
| --- | --- |
| 认证 | `POST /api/auth/login` |
| 房间 | `GET /api/rooms` · `POST /api/rooms/add\|remove\|pause\|resume` |
| 场次 | `GET /api/sessions` · `GET /api/sessions/<id>/detail` · `GET /api/sessions/<id>/gift-details` |
| 多场合并 | `GET /api/sessions/combined?ids=1,2,3` · `GET /api/sessions/combined/anchor-people` · `GET /api/sessions/combined/report` |
| 榜单图片 | `GET /api/rank-image/themes` · `GET /api/sessions/combined/rank-image` · `GET /api/sessions/<id>/rank-image` |
| 趋势 | `GET /api/hosts/trends?hostIds=..&range=30d` |
| 状态 / 运维 | `GET /api/status` · `POST /api/service/action` · `GET /api/export/*` |

---

<div align="center">

### 致谢

[douyinLive](https://github.com/jwwsjlm/douyinLive) — WebSocket 抓取代理 ·
[DouYin_Spider](https://github.com/ReaJason/DouYin_Spider) — 接口思路参考 ·
前端基于 [art-design-pro](https://github.com/Daymychen/art-design-pro) 二次开发

[MIT License](./LICENSE)

</div>
