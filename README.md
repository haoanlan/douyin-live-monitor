# 抖音直播监控

多房间抖音直播采集 + 可视化看板。一个进程同时跑采集 worker 与 Web 看板：自动检测开播/下播，
把弹幕、礼物、进场、在线人数写入 SQLite，并在看板里提供场次管理、榜单、画像、趋势、状态监控、
图片报告与多场次合并分析。

> ⚠️ 仅供学习与研究。请遵守抖音平台规则与所在地法律法规，不要用于商业或非法用途。

---

## 1. 这是什么

- **一套自托管的采集 + 看板**：数据落在本地 SQLite（`db/douyin.db`），不依赖任何云服务。
- **跟着主播开播自动记录**：检测到开播开始采集，确认下播后保存场次并算好各级汇总。
- **看板是给人看的**：总览、房间、场次、趋势、合并、查询、画像、状态，共 10 个页面。
- **能出图**：单场报告、多场合并报告、以及按主播生成的「感谢榜」图片（可挑模板）。

## 2. 能做什么

| 你想做的事 | 去哪儿 |
| --- | --- |
| 看今天/近期整体情况 | 总览 |
| 加直播间、暂停监控 | 房间管理 |
| 看某一场的完整数据 | 场次历史 → 点进某一场 |
| 看某个主播几周内的走势 | 趋势分析 |
| 把几场数据合成一份做对比 | 数据合并查看 |
| 查某个观众送了什么、说了什么 | 信息查询（按昵称搜）→ 用户画像 |
| 看采集是否正常、代理有没有断 | 状态监控 |
| 导出一张报告图 / 感谢榜图片 | 场次详情、数据合并查看里的下载按钮 |

## 3. 三分钟跑起来

### 3.1 需要什么

| 依赖 | 是否必须 | 说明 |
| --- | --- | --- |
| **Node.js 20.19+** | 必须 | 推荐 22.x |
| **Go 抓取代理**（douyinLive） | 必须 | 从 [douyinLive Releases](https://github.com/jwwsjlm/douyinLive/releases) 下载对应平台的二进制，放到项目根目录（Windows：`douyinLive-win-amd64.exe`；Linux：`douyinLive-linux-amd64`） |
| **抖音 cookie** | 必须 | 浏览器登录抖音网页版 → F12 → Application → Cookies → 复制完整 cookie 串 |
| **Chromium** | 可选 | 只有「图片报告 / 感谢榜图片」需要。可用 `npx playwright install chromium`，也会自动使用系统已装的 Chrome / Edge |

### 3.2 方式 A：Windows 发布包（最简单）

1. 解压 `douyin-live-<版本>-win.zip`（已内置 `node_modules` 与代理二进制，**不需要** `npm install`）。
2. 把 `config.example.yaml` 复制为 `config.yaml`，填入 cookie。
3. 双击 `start.bat`。
4. 打开 <http://127.0.0.1:9871>，默认账号 **admin / 123456**（请立刻在「个人中心」改密）。

### 3.3 方式 B：源码运行

```bash
# 后端依赖
npm install

# 前端依赖 + 构建（构建会先跑 vue-tsc 类型检查）
cd frontend && npm install && npm run build && cd ..

# 启动（worker 已内嵌在仪表盘进程里）
node web-dashboard.js
# → http://127.0.0.1:9871
```

> 如果 `npm install` 在 `better-sqlite3` 处报 `gyp ERR`，说明当前 Node 版本没有预编译包。
> 换 **Node 20 LTS** 或装好编译工具链（Windows：VS Build Tools；Linux：`python3 make g++`），
> 或直接用 **Docker**（见下）。

### 3.4 方式 C：Docker（Linux 服务器推荐）

```bash
cp config.example.yaml config.yaml      # 填 cookie
mkdir -p db logs && sudo chown -R 1000:1000 db logs
docker compose up -d --build
# → http://<服务器IP>:9871
```

镜像里已经包含 Node、Go 代理、中文字体，**默认也包含 Chromium**（图片报告可用）。
需要更小的镜像（不要截图能力）时：

```bash
WITH_PLAYWRIGHT=0 docker compose up -d --build
```

端口：**9871** 看板 / **1088** Go 抓取代理（代理只建议内网访问）。
Linux 部署的细节与排错见 [deploy/DEPLOY-linux.md](./deploy/DEPLOY-linux.md)。

### 3.5 配置

`config.yaml`（不要提交到仓库，已在 `.gitignore` 里）：

```yaml
cookie:
  douyin: "你的抖音登录cookie"
port: "1088"              # Go 代理端口
dashboard:
  port: "9871"
  host: "127.0.0.1"       # 需要局域网/公网访问时改 0.0.0.0
```

直播间列表：启动后直接在「房间管理」里增删（热生效），也可以改 `runtime-config.json`。
飞书推送（可选）用环境变量：`FEISHU_APP_ID` / `FEISHU_APP_SECRET`。

## 4. 页面使用指南

### 总览

- 顶部是累计数字卡，中间是各种榜单（热门礼物、送礼榜、弹幕活跃、主播贡献、最近场次）。
- 榜单行可以直接点进对应场次详情。
- 首次加载会先显示同形骨架，不会白屏或跳高度。

### 房间管理

- 添加直播间（填房间号或主页链接）、改名、暂停/恢复监控、删除。
- 「进详情」跳到该房间最近一场的场次详情。

### 场次历史

- 按直播间筛选历史场次，列表里有时间、时长、礼物数、钻石数。
- 点任意一场进「场次详情」。

### 场次详情

这是信息最密的一页：

- **统计卡**：峰值在线、总钻石、点赞、弹幕、用户、时长。
- **礼物排行 / 团播主播排名 / 弹幕排行**：各 Top 榜；点团播主播里的某个主播，会弹出「这个主播收到了谁的礼物」。
- **弹幕词云**：高频词汇。
- **最新动态**：弹幕 + 礼物时间线。
- 右上角的下箭头图标 = **下载榜单图片**（可选模板，见 4.1）。

#### 4.1 下载榜单图片

在「送出礼物的人员榜单」弹窗里，点标题栏右侧的下载图标 → 内容区切换成模板网格 →
选一套模板即按它生成并下载图片（模板清单来自渲染脚本，接口 `GET /api/rank-image/themes`）。

### 趋势分析

- 左侧选主播（可多选对比）+ 时间范围 + 口径（按天 / 按场次 / 按周 / 按月）。
- **默认按天**。量类指标（钻石、弹幕、礼物）用柱状图，人数/比率类用折线。
- 顶部有全局 KPI（钻石 / 送礼用户 / 弹幕 / 时长 / 钻时 / Top10 占比），能算环比的都带 ↑↓。

### 数据合并查看

- 选若干场次（可跨主播），点「查看合并」。
- 合并弹窗里有：总数据报告下载、三张榜单（礼物 / 主播 / 弹幕）、以及**按主播下载感谢榜单**。
- 点某个主播 → 该主播在这些场次里收到了谁的礼物（头像已尽量补全）。

### 信息查询

- 按昵称模糊搜人，看到 TA 的弹幕、礼物与出现过的场次，可进「用户画像」。

### 用户画像

- 按 sec_uid 聚合：送礼历史、活跃时段、常用昵称、参与过的场次。

### 状态监控

- 守护进程 / Go 代理 / WebSocket 连接 / 正在录制的房间，以及运行日志。
- 采集异常（代理断了、cookie 失效）通常先在这里看出来。

### 个人中心

- 账号信息与改密。登录令牌只在本次运行期间有效，重启看板后需要重新登录。

## 5. 数据与文件

| 路径 | 内容 |
| --- | --- |
| `db/douyin.db` | SQLite 主库（WAL 模式），所有采集数据 |
| `config.yaml` | 你的 cookie 与端口配置（**不要提交**） |
| `runtime-config.json` | 直播间列表（看板里增删会写这里） |
| `reports/` | 自动生成的报告图片 |
| `logs/` | 运行日志 |

表结构与字段口径见 **[docs/DATABASE.md](./docs/DATABASE.md)**。

## 6. 常见问题

**看板打不开 / 端口被占**
换端口：`DASHBOARD_PORT=9872 node web-dashboard.js`，或改 `config.yaml` 的 `dashboard.port`。

**能打开但没有数据**
先看「状态监控」：Go 代理是否连上、WebSocket 是否正常。代理二进制缺失时看板能起来但采不到数据。

**cookie 失效**
表现：状态页显示连接异常 / 采不到新数据。重新从浏览器复制 cookie，更新 `config.yaml` 后重启。

**图片报告生成失败**
多数是 Chromium 缺失或路径找不到。装一次 `npx playwright install chromium` 即可；
或者确认系统里有 Chrome / Edge（程序会优先用系统浏览器）。Docker 镜像默认已包含。

**Docker 里 `/app/config.yaml` 报"是目录"**
宿主机缺少 `config.yaml` 时 Docker 会自动建一个同名目录。先在宿主机 `cp config.example.yaml config.yaml`。

**Docker 里 db/logs 不可写**
容器内以 uid 1000 运行：`sudo chown -R 1000:1000 db logs`，或用 `APP_UID=$(id -u) APP_GID=$(id -g)` 覆盖。

**`npm install` 在 better-sqlite3 处失败**
见 3.3 的说明：换 Node 20 LTS、装编译工具链，或改用 Docker。

## 7. 从旧版本升级

- 数据在 `db/douyin.db`，升级代码不会动它；升级前建议备份一份。
- `frontend/dist` 是构建产物，拉取代码后需要重新 `npm install && npm run build`（或用发布包自带的 dist）。
- 预聚合表在**场次结束时**写入，旧场次的历史数据不会被自动重算。

## 8. 给开发者 / 对接方

- 自检脚本、数据口径、容易踩的坑：**[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)**
- 数据库表结构：**[docs/DATABASE.md](./docs/DATABASE.md)**
- WebSocket 字段参考：**[docs/websocket-fields-ref.md](./docs/websocket-fields-ref.md)**
- 所有 `/api/*` 需要登录令牌：`Authorization: Bearer <token>`，返回 JSON（gzip）。

主要接口速览：

| 域 | 接口 |
| --- | --- |
| 认证 | `POST /api/auth/login` |
| 房间 | `GET /api/rooms` · `POST /api/rooms/add\|remove\|pause\|resume` |
| 场次 | `GET /api/sessions` · `GET /api/sessions/<id>/detail` · `GET /api/sessions/<id>/gift-details` |
| 多场合并 | `GET /api/sessions/combined?ids=1,2,3` · `GET /api/sessions/combined/anchor-people` · `GET /api/sessions/combined/report` |
| 榜单图片 | `GET /api/rank-image/themes` · `GET /api/sessions/combined/rank-image` · `GET /api/sessions/<id>/rank-image` |
| 趋势 | `GET /api/hosts/trends?hostIds=..&range=30d` |
| 状态 / 运维 | `GET /api/status` · `POST /api/service/action` · `GET /api/export/*` |

## 9. 致谢与 License

- [douyinLive](https://github.com/jwwsjlm/douyinLive) — WebSocket 抓取代理
- [DouYin_Spider](https://github.com/ReaJason/DouYin_Spider) — 接口思路参考
- 前端基于 [art-design-pro](https://github.com/Daymychen/art-design-pro) 二次开发（品牌与页面已重做）

MIT License — 见 [LICENSE](./LICENSE)。
