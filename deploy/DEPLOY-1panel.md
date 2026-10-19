# 用 1Panel 部署（Node.js 运行环境）

> 目标：**把文件放进一个目录 → 在 1Panel 填好「创建运行环境」表单 → 点确认 → 就能用**。
> 不需要写 Dockerfile、不需要命令行编译、不需要联网下载代理。

---

## 一、准备目录（只做一次）

在 1Panel 的 **文件** 里进到 `/opt/` ，新建目录 `douyin-monitor`，最终结构必须是：

```text
/opt/douyin-monitor/
├─ web-dashboard.js          ← 启动入口
├─ monitor.js  db-sqlite.js  douyin-user.js  feishu-send.js
├─ report-image.js  thanks-rank.js  sync-gift-icons.js
├─ lib/                      ← 后端实现（routes / worker）
├─ frontend/
│  └─ dist/                  ← 前端构建产物（必须有 index.html）
├─ assets/
│  └─ cute-ev.png            ← 榜单图片素材
├─ package.json  package-lock.json
├─ config.yaml               ← ★ 你自己填 cookie（下一步创建）
├─ douyinLive-linux-amd64    ← ★ 代理二进制 40.8MB，必须 chmod +x
├─ db/                       ← 空目录，数据会写这里
└─ logs/                     ← 空目录
```

**文件从哪来**：用发布包 `douyin-live-1.1.0-linux.zip`（自带 `frontend/dist` ✓），
解压后把里面的内容**全部**放到 `/opt/douyin-monitor/`。

**代理二进制单独传**（服务器下不到 GitHub，这是必须手动的一步）：

```powershell
# 在你的 Windows 上执行
scp "C:\路径\douyinLive-linux-amd64" root@服务器IP:/opt/douyin-monitor/
```

```bash
# 服务器上（1Panel 终端）
cd /opt/douyin-monitor
chmod +x douyinLive-linux-amd64
mkdir -p db logs
# 确认关键文件都在
ls -lh douyinLive-linux-amd64 frontend/dist/index.html web-dashboard.js
# 生成配置（然后编辑填 cookie）
cp config.example.yaml config.yaml
vi config.yaml        # 只需要填 cookie.douyin；dashboard.host 保持 127.0.0.1
```

`config.yaml` 最小内容：

```yaml
cookie:
  douyin: "你的抖音cookie"
port: "1088"
dashboard:
  port: "9871"
  host: "127.0.0.1"
```

---

## 二、在 1Panel 创建运行环境（照抄这张表）

**运行环境 → 创建运行环境 → 应用选 `Node.js`**，然后：

| 表单字段 | 填什么 | 说明 |
| --- | --- | --- |
| **名称** | `douyin-live` | 随意 |
| **应用** | `Node.js` + 版本选 **22.x** | ⚠️ **千万不要选 25**：`better-sqlite3` 是原生模块，Node 25 没有预编译包，装不上 |
| **项目目录** | 点文件夹图标 → 选 `/opt/douyin-monitor` | 必须是有 `web-dashboard.js` 的那层 |
| **启动命令** | 打开右侧 **「自定义启动命令」** → 填 `node web-dashboard.js` | 下拉是空的，因为我们的 package.json 没有 `start` 脚本 |
| **容器名称** | `douyin-live-env` | ⚠️ 别用 `douyinlive`（避免和以前 compose 的容器重名） |
| **包管理器** | `npm` | 默认即可 |
| **安装 node_modules** | **保持开启** | 由 1Panel 在容器里执行 `npm install` |
| **镜像源** | `https://registry.npmmirror.com` | 国内网络建议用这个，不然装依赖很慢 |
| **端口** | 容器端口 `9871` → 主机端口 `9871` | 1088 **不用映射**（代理只在容器内部用） |

再切到 **「环境变量」** 标签，加两条：

```text
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PORT=9871
```

> 为什么是 `0.0.0.0`：容器内必须监听全部地址，1Panel 的端口映射才能把 9871 转出去。
> `config.yaml` 里保持 `127.0.0.1` 无所谓，环境变量优先级更高。

**「挂载」** 标签：确认 `/opt/douyin-monitor` 已挂到容器内同路径（1Panel 会按项目目录自动加，检查一眼即可）。
**「主机映射」** 不需要填。

点 **确认** → 1Panel 开始创建容器并 `npm install`（首次 1-3 分钟，`better-sqlite3` 会下载预编译包）。

---

## 三、确认它起来了

**运行环境** 列表里状态应为 **运行中**。点进容器 → **日志**，看到类似：

```
[dashboard] http://0.0.0.0:9871
[worker] started ...
```

浏览器打开：

```
http://服务器IP:9871          → 出现登录页
默认账号 admin / 123456       → 登录后立刻去「个人中心」改密
```

**功能自检**（登录后）：

| 检查 | 期望 |
| --- | --- |
| 状态监控 → Go 代理 | 已连接（没连上 = 代理二进制没执行权限） |
| 状态监控 → WebSocket | 正常 |
| 房间管理 | 能看到你的直播间，能加新的 |
| 总览 | 有历史数据（如果是全新库则为 0，正常） |

---

## 四、挂域名 + HTTPS（1Panel 网站功能）

**网站 → 创建网站**：

| 字段 | 填什么 |
| --- | --- |
| 类型 | **反向代理** |
| 域名 | `live.你的域名.com`（先解析到服务器 IP） |
| 代理地址 | `http://127.0.0.1:9871` |

创建后进该网站 → **反向代理** → 配置文件，确认并补上超时（导出/报告可能较慢）：

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout  300s;
proxy_send_timeout  300s;
client_max_body_size 20m;
```

然后该网站 → **HTTPS** → Let's Encrypt 一键申请 → 开「强制 HTTPS」。

**安全**：云安全组/防火墙**只放 80/443**，把 9871 关掉；**1088 绝对不要开放**（Go 代理没有鉴权）。

---

## 五、日常使用

| 操作 | 在哪做 |
| --- | --- |
| 重启 | 1Panel → 运行环境 → 对应环境 → 重启 |
| 看日志 | 运行环境 → 日志（或 `docker logs douyin-live-env`） |
| 更新代码 | 覆盖 `/opt/douyin-monitor` 里的文件（保留 `config.yaml`、`db/`、`logs/`）→ 重启环境；`package.json` 变了才需要重新装依赖 |
| 备份 | 只备份 `/opt/douyin-monitor/db/douyin.db` 即可（1Panel 计划任务里加个 tar 也行） |
| 换端口 | 改「端口」映射 + 环境变量 `DASHBOARD_PORT`，同步改反代地址 |

---

## 六、常见问题（都是这个部署方式特有的）

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 创建环境后容器反复重启，日志报 `Cannot find module 'better-sqlite3'` | **Node 版本选了 25 / 20 之前**，原生模块没装上 | 删掉环境重建，**Node 选 22.x** |
| 日志报 `gyp ERR! not ok` | 同上（没有预编译包 + 容器内无编译工具） | 换 **Node 22** |
| 服务能起，但页面 502 | 环境变量没加 `DASHBOARD_HOST=0.0.0.0` | 补环境变量 → 重启 |
| 日志报 `EADDRINUSE` | 9871 被其他容器/进程占了 | 换主机端口（如 19871），反代地址同步改 |
| 登录后「状态监控」显示代理未运行 | `douyinLive-linux-amd64` 没有执行权限 / 不在项目目录 | 宿主机 `chmod +x`，确认文件在 `/opt/douyin-monitor/` 根下 |
| 采不到数据 | `config.yaml` 的 cookie 没填 / 已失效 | 填好 cookie → 重启环境 |
| 页面白屏 | `frontend/dist/index.html` 不存在 | 用发布包（自带 dist），或本地构建后把 dist 传上去 |
| 反向代理 504 | 导出/报告耗时长 | 补 `proxy_read_timeout 300s` |

---

## 七、和 Docker/Dockerfile 方式的区别（为什么推荐这条）

| | 本教程（Node 运行环境） | 仓库里的 Dockerfile |
| --- | --- | --- |
| 需要构建镜像 | ❌ 不需要 | ✅ 需要，且要下代理二进制 |
| 服务器能连 GitHub | ❌ 不需要 | ✅ 需要（否则构建卡死） |
| 依赖安装 | 1Panel 自动 `npm install` | 构建阶段 `npm ci` |
| 升级 | 覆盖文件 + 重启 | 重新 build 镜像 |
| 适合 | **本场景** ✅ | 想固定镜像/多机分发 |
