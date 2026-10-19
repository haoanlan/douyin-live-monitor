# 仓库结构说明

> 每个目录"是什么 / 能不能删 / 谁在用"。改代码前先看这张表，避免误删运行时必需的文件。
> 最后核对：2026-10-19。

## 顶层

| 路径 | 是什么 | 能不能删 |
| --- | --- | --- |
| `web-dashboard.js` | 看板入口（同进程内嵌采集 worker），默认 9871 | **不能**（主入口） |
| `monitor.js` | 采集 worker（可独立跑，也可被 dashboard 嵌入） | **不能** |
| `db-sqlite.js` | SQLite 封装（WAL、建表、预聚合写回） | **不能** |
| `douyin-user.js` | 抖音用户信息查询（头像等，供补全） | **不能** |
| `feishu-send.js` | 飞书推送（可选功能） | 不能（HTTP 路由引用） |
| `report-image.js` | 下播报告图片（Playwright 截图） | 不能 |
| `thanks-rank.js` | 「感谢榜」图片渲染（14 套模板，Playwright 渲染 HTML → JPEG） | **不能**（榜单图片接口在用） |
| `sync-gift-icons.js` | 礼物图标库同步脚本 | 不能（运维用） |
| `runtime-config.json` | 直播间列表（看板里增删会写它） | 本地产物，**别提交** |
| `config.example.yaml` | 配置样例（cookie / 端口） | 不能（发布包要用） |
| `config.yaml` | 你的真实配置（含 cookie） | **gitignore**，绝不能提交 |

## 目录

| 目录 | 是什么 | 能不能删 |
| --- | --- | --- |
| `lib/` | 后端实现：`routes/`（HTTP 路由）、`worker/`（采集）、`config-reader`、`browser-path` 等 | **不能** |
| `frontend/` | Vue 3 + TS + Element Plus 看板源码；`dist/` 是构建产物（已 gitignore） | 源码不能删；`dist/` 可随时重建 |
| `assets/` | **榜单图片渲染用的素材**（`thanks-rank.js` 以 base64 内联进 HTML） | **不能**（运行时用） |
| `scripts/` | 开发/运维脚本。分三类见下 | 见下 |
| `test/` | 单元测试（`node:test`，`npm test` 跑） | 不能（有真实断言） |
| `deploy/` | **Linux systemd 部署**（2 个 `.service` + `DEPLOY-linux.md`） | 不能（部署用） |
| `docs/` | 项目文档（见下表）；`archive/` 是历史归档 | 不能（`archive/` 可整体删，只是追溯用） |
| `team/` | 本地开发产物（截图、实验），**不在 git 里** | 可删（纯本地） |
| `db/` `logs/` `reports/` | 数据库 / 日志 / 报告图片 | 都是 gitignore 的运行时产物；**`db/` 删了数据就没了** |

## `assets/` 现状（需要留意）

`thanks-rank.js` 引用了 6 个素材，但仓库里只有 **1 个**：

| 素材 | 状态 | 说明 |
| --- | --- | --- |
| `cute-ev.png` | ✓ 存在 | 当前可用模板在用 |
| `kitty-star.png` / `kitty-heart.png` / `story-cloud.png` / `story-moon.png` / `story-chibi.png` | ✗ 缺失 | 只被**已下线的可爱风模板**（cute-journal / cute-candy / cute-story / cute-chibi）引用；那些模板已从 `MAG_THEME_NAMES` 移除，对应渲染函数保留但不可达 → **当前不会触发**，属于待清理的死引用 |

## `scripts/` 的三类

| 类别 | 例子 | 说明 |
| --- | --- | --- |
| **构建/检查（开发必用）** | `sfc-check.js`、`vite-module-check.js`、`import-check.js`、`build-release.js` | 改完代码跑；`build-release.js` 打 win/linux 发布包 |
| **运行时体检（开发可选）** | `mobile-check.js`、`ui-regression.js`、`transition-check.js`、`ui-audit-dark.js`、`ui-audit-layout.js`、`ui-audit-probe.js`、`kbd-regression.js` | **只用于开发期检查 UI**（对比度 / 布局 / 动效 / 跳转 / 键盘），运行时不依赖 |
| **运维/诊断** | `db-checkpoint.js`、`db-verify.js`、`db-recover.js`、`db-diagnose.js`、`db-overview.js`、`reset-dashboard-password.js`、`fetch-proxy-binary.js`、`fetch-proxy-win.js`、`service-status.js`、`check-room-status.js`、`ws-debug.js`、`audit-auth.js`、`icon-offline-check.js` | 排障/运维用，保留 |

## `docs/` 的现状

| 文档 | 面向 | 内容 |
| --- | --- | --- |
| `../README.md` | **使用者** | 安装（Windows包 / 源码 / Docker）、页面使用指南、常见问题 |
| `DEVELOPMENT.md` | 改代码的人 | 数据口径、容易踩的坑、自检脚本 |
| `DATABASE.md` | 改代码的人 | 16 张表的字段/索引（由真实 schema 生成） |
| `RELEASE-CHECKLIST.md` | 发版的人 | 发布前逐条验证清单 |
| `websocket-fields-ref.md` | 对接方 | Go 代理推送的字段参考 |
| `AUDIT-2026-10-18-selfcheck.md` | 维护者 | 一次完整自查记录（当前有效） |
| `archive/` | — | 早期审计、HANDOFF、一次性 spec（**已脱节，仅追溯**） |

## 两条部署路线（别混淆）

| 路线 | 入口 | 适用 |
| --- | --- | --- |
| **Docker** | `Dockerfile` + `docker-compose.yml` | Linux 服务器推荐；镜像内固化 Node / 代理 / 字体 / Chromium |
| **systemd 直跑** | `deploy/*.service` + `deploy/DEPLOY-linux.md` | 已有 Node 环境的 Linux；需自行装代理二进制与 Chromium |
| **Windows 预编译包** | `scripts/build-release.js` 产出的 zip | 终端用户；内置 node_modules，**需 Node 22**（原生模块 ABI 绑定） |

## 发布包的 Node 版本约束（重要）

`better-sqlite3` 是原生模块，ABI 与 Node 大版本绑定：

- **Windows 预编译包**（内置 node_modules）：必须在**打包时那个 Node 大版本**下运行（当前 **Node 22**）。
  版本不符会报 `NODE_MODULE_VERSION 127 vs 108`。启动脚本已做版本检查，并提示
  `nvm use 22` 或 `npm rebuild better-sqlite3`。
- **源码 / Linux 包**：`npm install` 会按当前 Node 编译，所以源码头上的要求是 **Node 20.19+**。
