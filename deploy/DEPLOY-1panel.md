# 用 1Panel 部署成网站

> 思路：**后端只在 `127.0.0.1:9871` 上跑**（Docker 或 systemd 都行），
> **1Panel 的「网站 → 反向代理」**负责域名、HTTPS、外网访问。
> 不要把 9871 直接暴露到公网 —— 反代能顺便加 SSL 与访问控制。

---

## 一、先决定后端怎么跑（二选一）

| 方式 | 适合 | 在 1Panel 里怎么管 |
| --- | --- | --- |
| **A. Docker** | 想隔离、想一键迁移 | 容器 → 编排（compose） |
| **B. systemd** | 不想用 Docker / 想直接看进程 | 用本仓库 `deploy/deploy.sh` 装好，1Panel 里不用管 |

---

## A. Docker 路线（1Panel「容器 → 编排」）

### A1. 准备目录

在 1Panel 的 **文件** 里建目录，例如 `/opt/1panel/apps/douyin-live`，把这几样放进去：

```
docker-compose.yml     （仓库根目录那份，可改）
Dockerfile             （仓库根目录那份）
douyinLive-linux-amd64 （代理二进制，40.8MB，必须先传上来）
config.yaml            （先 cp config.example.yaml 再填 cookie）
db/  logs/             （建两个空目录，属主 1000:1000）
```

> ⚠️ **代理二进制必须在本地准备好**：服务器直连 github 会卡死（实测）。见文末「绕开代理下载」。

### A2. 改 Dockerfile 用本地代理（推荐）

默认 Dockerfile 会 `curl` 下载代理（会失败）。把 **proxy-download 阶段**换成从构建上下文复制：

```dockerfile
# 原：proxy-download 阶段 curl 下载
# 改：直接把同目录的 douyinLive-linux-amd64 复制进镜像
```

> 这一步我可以直接帮你改好推上去 —— 说一句「改 Dockerfile 用本地代理」即可。

### A3. 1Panel 里创建编排

**容器 → 编排 → 创建编排**：

- 名称：`douyin-live`
- 来源：**从文件读取**（选 `docker-compose.yml`）或**粘贴内容**
- 工作目录：`/opt/1panel/apps/douyin-live`
- 点「确认」，等构建完成（首次 5-15 分钟：前端构建 + better-sqlite3 编译 + Chromium）

构建成功后：**容器 → 容器** 里应看到 `douyinlive` 状态 **运行中/健康**。

---

## B. systemd 路线

在 **1Panel 的「终端」**里，进到项目目录执行：

```bash
cd /opt/douyin-monitor
bash deploy/deploy.sh
```

脚本会装依赖、编译、写 systemd 单元、开机自启、健康检查。
（详见 `deploy/deploy.sh` 头部注释；进程与 SSH/面板完全解耦 ✓）

---

## 二、1Panel 建站（反向代理）

**网站 → 网站 → 创建网站**：

| 字段 | 填什么 |
| --- | --- |
| 类型 | **反向代理** |
| 域名 | 你的域名（如 `live.example.com`，需先解析到服务器 IP） |
| 代理地址 | `http://127.0.0.1:9871` |
| 端口 | 外部 80/443，内部留空 |

创建后：

1. **点进网站 → 反向代理 → 配置文件**，确认 `proxy_pass http://127.0.0.1:9871;`
2. 加上这几个头（1Panel 默认一般已有，没有就补）：

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

# 导出/报告接口可能耗时较长，避免 504
proxy_read_timeout  300s;
proxy_send_timeout  300s;
# 导出 CSV 可能较大
client_max_body_size 20m;
```

3. **SSL**：网站 → HTTPS → **Let's Encrypt** 一键申请 → 开启「强制 HTTPS」
4. 保存 → 用域名访问，应看到登录页

---

## 三、域名与安全

| 项 | 建议 |
| --- | --- |
| 9871 端口 | **不要**在防火墙/云安全组里对公网开放 ✗（只让本机反代访问 ✓） |
| 1088 代理端口 | **绝对不要**开放 ✗（Go 代理本身没有鉴权） |
| 面板入口 | 1Panel 自带「安全」→ 改面板端口 + 开启二次验证 ✓ |
| 登录 | 首次登录 `admin / 123456` → **立刻在「个人中心」改密** ✓ |
| 访问控制 | 如果只想自己用：反代里加 IP 白名单 / Basic Auth ✓ |

---

## 四、部署后验证

```bash
# 服务器上
curl -sI  http://127.0.0.1:9871 | head -1                                  # 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9871/api/overview # 401

# 从外网（你的电脑）
curl -sI https://live.example.com | head -1
```

浏览器访问域名 → 登录 → 「状态监控」页确认：**Go 代理已连接、WebSocket 正常**。

---

## 五、绕开代理下载（必须处理）

服务器连不上 `github.com` 时，Docker 构建会卡在 `proxy-download` 阶段。三种办法：

1. **本地 COPY**（推荐）：把 `douyinLive-linux-amd64` 放进构建目录，Dockerfile 改成 `COPY`（我可代改 ✓）；
2. **可达镜像源**：构建时传参
   ```bash
   PROXY_BINARY_URL="https://ghproxy.cc/https://github.com/jwwsjlm/douyinLive/releases/download/v2.3.1/douyinLive-v2.3.1-0e506f3cf935-linux-amd64.tar.gz" \
   PROXY_BINARY_SHA256="85d735e62468a8a3db956cd9bf978bc1fc79fd276632428583d666506738a456" \
   docker compose up -d --build
   ```
3. **systemd 路线**：不需要下载，直接把二进制放在项目目录即可 ✓

---

## 六、更新

**Docker**：覆盖新代码/新镜像 → 1Panel「容器 → 编排 → 重新构建」或 `docker compose up -d --build`
**systemd**：覆盖新代码 → `npm install --omit=dev` → `sudo systemctl restart douyin-live`

数据始终在 `db/douyin.db`，更新不会动它；升级前备份一份。
