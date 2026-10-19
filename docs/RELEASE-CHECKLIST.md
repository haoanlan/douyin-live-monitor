# 发布验证清单（Release Checklist）

> 用途：**在发布机器上照单逐条执行**，每条都要拿到实测结果才能打勾。
> 当前状态（2026-10-19，在 Windows 开发机上）：**Windows 包 ✅ 已验**、**Linux 包 ⏳ 待验**、**Docker ⏳ 待验**。
>
> 为什么 Linux 与 Docker 没验：开发机没有 Docker，也不是 Linux。

---

## 0. 前置（打包机需要）

| 依赖 | 检查命令 | 期望 |
| --- | --- | --- |
| Node 22（打包用） | `node -v` | 22.x |
| npm | `npm -v` | 10.x |
| 代理二进制（两个平台） | `ls -lh douyinLive-*` | 各约 40MB |
| Docker（验 Linux/镜像用） | `docker version` | 有 Server 段 |

打包机先安装并构建一次前端：

```bash
npm install
cd frontend && npm install && npm run build && cd ..
```

---

## 1. 产出发布包 ✅（已在 Windows 验过这一步）

```bash
node scripts/build-release.js
ls -lh dist-release/*.zip
```

| 检查项 | 期望 | 实测（2026-10-19） |
| --- | --- | --- |
| win 包大小 | 20-30MB | **23.1 MB** ✅ |
| linux 包大小 | 14-20MB | **15.5 MB** ✅ |
| zip 条目分隔符 | 正斜杠（标准 zip） | ✅ `ZipFile.CreateFromDirectory` |
| win 包含 `node_modules` | 有 | ✅ |
| win 包含代理 | `douyinLive-win-amd64.exe` 41.7MB | ✅ |
| linux 包含代理 | `douyinLive-linux-amd64` | ✅ |

> ⚠️ 不要用 PowerShell 5 的 `Compress-Archive` —— 它写出反斜杠条目（非标准 zip），
> `Expand-Archive` 会解出 **0 个文件**。脚本里已改用 .NET `ZipFile.CreateFromDirectory`。

---

## 2. Windows 包 ✅ 已验证

```powershell
# 解压到仓库外的干净目录（模拟用户）
Expand-Archive -Path dist-release/douyin-live-1.1.0-win.zip -DestinationPath $env:TEMP/dl-win -Force
cd $env:TEMP/dl-win/douyin-live-1.1.0-win
copy config.example.yaml config.yaml     # 填 cookie
$env:DASHBOARD_PORT='9872'
node web-dashboard.js
```

| 检查项 | 期望 | 实测（2026-10-19） |
| --- | --- | --- |
| 解压文件数 | 1000+ | **1244** ✅ |
| `node_modules` | 存在 | ✅ |
| 首页 | HTTP 200 | **200** ✅ |
| `/api/overview`（无 token） | HTTP 401 | **401** ✅ |
| 是否需要 `npm install` | 不需要 | ✅（better-sqlite3 已随包） |

---

## 3. Linux 包 ⏳ 待验证

**注意**：Linux 包**不带** `node_modules`（原生模块需在 Linux 上编译）。两种验证方式：

### 3.1 在 Linux 机器上（Node 20/22）

```bash
unzip douyin-live-1.1.0-linux.zip
cd douyin-live-1.1.0-linux
chmod +x start.sh douyinLive-linux-amd64
cp config.example.yaml config.yaml      # 填 cookie
./start.sh                              # 首次会 npm install（better-sqlite3 需要 python3/make/g++）
curl -I  http://127.0.0.1:9871          # 期望 200
curl -i  http://127.0.0.1:9871/api/overview   # 期望 401
```

| 检查项 | 期望 | 实测 |
| --- | --- | --- |
| `npm install` 成功（有编译工具链时） | 无 gyp ERR | ⏳ |
| 首页 | HTTP 200 | ⏳ |
| `/api/overview` 无 token | HTTP 401 | ⏳ |
| 代理能起（状态页显示已连接） | 是 | ⏳ |

> 若 `npm install` 报 `gyp ERR`：说明缺编译工具链。`apt-get install -y python3 make g++`，
> 或直接改用 Docker（下一节）。

### 3.2 用 Docker 代验（推荐，同时验证第 4 节）

---

## 4. Docker 镜像 ⏳ 待验证

```bash
cp config.example.yaml config.yaml
mkdir -p db logs && sudo chown -R 1000:1000 db logs
docker compose up -d --build
docker ps --filter name=douyinlive
```

| 检查项 | 期望 | 实测 |
| --- | --- | --- |
| `docker compose build` 成功（含前端构建、better-sqlite3 编译冒烟测试） | 成功 | ⏳ |
| 容器状态 | `Up (healthy)` | ⏳ |
| 首页 `curl -I http://127.0.0.1:9871` | 200 | ⏳ |
| `/api/overview` 无 token | 401 | ⏳ |
| 容器内 Chromium 可用（生成榜单图片） | 成功出图 | ⏳ |
| 中文字体（图片里中文不乱码） | 正常 | ⏳ |
| 宿主机 `db/` 有 `douyin.db` 写入 | 有 | ⏳ |

**不要 Chromium 的小镜像**（没有图片报告能力）：

```bash
WITH_PLAYWRIGHT=0 docker compose up -d --build
```

---

## 5. 打 tag 与发布

```bash
# 版本号在 package.json / frontend/package.json（当前 1.1.0）
git tag -a v1.1.0 -m "douyin-live 1.1.0"
git push origin v1.1.0

# 在 GitHub Releases 里上传：
#   dist-release/douyin-live-1.1.0-win.zip
#   dist-release/douyin-live-1.1.0-linux.zip
#   douyinLive-win-amd64.exe / douyinLive-linux-amd64（单独传，供源码用户下载）
```

发布后把 Releases 链接补进 README 的「3.1 需要什么 → Go 抓取代理」一行。

---

## 6. 已知限制（发布说明里要写）

- **Linux 包不含 node_modules**：首次运行需要 `npm install`，且 `better-sqlite3` 需要编译工具链；**推荐用 Docker**。
- **Windows 包含 node_modules**：因此在别的 Node 大版本上（如 20）可能不兼容，建议用与打包时相同的 Node 22。
- **图片报告需要 Chromium**：Docker 镜像已内置；源码/包方式需 `npx playwright install chromium` 或系统 Chrome/Edge。
- **代理二进制不进 git**：从 Releases 下载，放到项目根目录。
- **`.gitignore` 已忽略**：`db/`、`logs/`、`reports/`、`config.yaml`、`frontend/dist/`、`dist-release/`、代理二进制。
