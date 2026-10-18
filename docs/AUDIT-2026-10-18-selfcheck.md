# 自查报告 · 2026-10-18

范围：`数据合并查看` 这一轮开发（合并接口、合并弹窗、移动端 tab / 悬浮操作、下载）之后的
**规范性、统一性、细节、架构** 自查，以及 **Windows 开发 → Linux 部署** 的环境核查。
只记录「结论 + 证据 + 处理」，不重复功能说明。

---

## 一、已修掉的问题（本次改动）

| # | 问题 | 处理 | 证据 |
| --- | --- | --- | --- |
| 1 | 榜单模板中文名在 `detail` 和 `combined` 各存一份，改一处忘另一处 | 抽到 `frontend/src/utils/rank-themes.ts`，两页共用 | 两页各只剩一个 `import` |
| 2 | `combined` 页面自己写了 `matchMedia` 监听，与 `useIsMobile` hook 重复 | 改用 `useIsMobile()`，并删掉自建监听 / `onUnmounted` | `mobileMq` 已无引用 |
| 3 | `report-image.js` 的 CLI 多场次分支复制了一份合并逻辑（与 `loadMergedFromDb` 漂移风险） | CLI 直接调 `loadMergedFromDb(ids)` | 两处同源，少 ~30 行重复 |
| 4 | `detail` 页残留未使用的 `echarts` 导入（lint error） | 删除 | `eslint` 0 error |
| 5 | `dashboard` 未使用的 `suppressByRootCause()`、`status` 两个未使用 computed、`rooms` 未使用的 `catch (e)`、`trends` 未使用的 `Streamer` 类型 | 全部清理 | 我们自有代码 **lint 0 问题**（只剩 prettier 格式项） |
| 6 | 下载超时前后端不一致（前端 120s / 后端渲染 180s），大报告前端先断 | `downloadWithAuth` 提到 180s | `utils/download.ts` 注释说明 |
| 7 | `douyin-qrlogin.js` 把 Windows 浏览器路径写死排在最前，Linux 报错有误导性 | 按平台给候选 | `process.platform` 分支 |
| 8 | 单场 `/report`、`/rank-image` 用 `startsWith/endsWith` 匹配，会吃掉 `/api/sessions/combined/*`（曾导致 404 / 400） | 改成 `^/api/sessions/\d+/(report|rank-image)$` 正则 | 合并接口验证通过 |

---

## 二、清理的垃圾文件

| 类别 | 内容 | 处理 |
| --- | --- | --- |
| 一次性脚本 | `scripts/tmp-*.js`（本轮验证/探针脚本，75 个） | 已删 |
| 历史一次性脚本 | `e2e-*`、`dev-*`、`probe-*`、`measure-*`、`rooms-*`、`page-shot`、`scroll-check`、`anim-check`、`api-shape`、`audit-session-*`、`check-test-room`、`mobile-audit`、`service-action-test`、`vite-module-error`（33 个） | 已删 |
| 无引用脚本 | 根目录 `thanks-rank-diamonds.js`（150KB 旧版榜单）、`merge-sessions.js`（写死场次 31/32/33 的一次性脚本）、`query-user-gifts.js`（临时查询工具） | 已删；`ws-debug.js` 移到 `scripts/` 保留（调试 WebSocket 消息用） |
| 无引用素材 | `assets/cute-cat.png`、`assets/guofeng-blossom.jpg`（0 处引用） | 已删，只留 `assets/cute-ev.png`（模板在用） |
| 过程产物 | `logs/`（60.7MB 截图/日志）、`reports/`（35MB 生成的榜单图） | 已清空（目录保留，均已 gitignore，可自动重建） |

保留的脚本都是**运维或检查**类：`db-*`（诊断/备份/恢复）、`fetch-proxy-*`、`service-status`、
`reset-dashboard-password`、`mobile-check`、`ui-regression`、`import-check`、`vite-module-check`、
`sfc-check`、`gen-icon-subset`、`icon-offline-check`、`ws-debug`。

---

## 三、架构与规范问题（记录，未改）

按优先级排：

1. **`lib/routes/sessions.js` 已 889 行**，里面混了：场次列表、删除、报告图、榜单图、合并数据、
   合并报告、合并送礼人员。合并相关已经占约 300 行，建议拆成 `lib/routes/combined.js`。
   当前路由顺序敏感（`/report`、`/rank-image` 必须在合并路由之前用正则排除），拆文件能根治。
2. **`frontend/src/views/douyin/combined/index.vue` 1699 行**（模板 ~500、逻辑 ~700、样式 ~500）。
   建议拆成 `CombinedFilters.vue` / `CombinedCard.vue` / `CombinedResultDialog.vue` /
   `useCombinedDownload.ts`，现在改一个弹窗细节要在 1700 行里跳。
3. **两份 HTML 模板脚本**：`report-image.js` 1536 行、`thanks-rank.js` 1897 行，HTML/CSS 直接拼字符串。
   短期不动（能用、有测试），但改样式时容易踩转义；长期建议模板外置成 `.html` + 占位替换。
4. **合并的场次上限是硬编码**：感谢榜单 20 场（脚本按 ids 拼文件名，超了撞 260 字符路径）、
   报告图 10 场（内存/耗时）。前后端各写了一次，建议抽常量或由后端 `/api/sessions/combined/limits` 下发。
5. **prettier 未强制**：全仓 600+ 处格式差异（模板自带代码为主，本次触及的文件也有历史格式）。
   我们自己的改动已经过 `eslint --fix`，但仓库层面没有 CI 校验，建议加 `lint:check` 到 CI，
   或对 `src/views/douyin/**` 单独跑 prettier。
6. **模板自带 5 处 lint 问题**（`isExternalLink`、`PAGE_OUT_MS`、`fontSize` 等，位于 `src/` 模板页面），
   不属于本次范围，记录在此。
7. **`logs/` 与 `reports/` 无自动清理**：榜单/报告图按「场次集合+收礼人」哈希命名，
   长期会慢慢堆积（本次清理掉了 35MB）。建议加一个「保留 N 天」的清理任务。

---

## 四、Linux 部署核查

结论：**可以部署**，Docker 路线已完备；裸机多两步（Chromium + 中文字体）。逐项：

| 项 | 结论 | 说明 |
| --- | --- | --- |
| 换行符 | ✅ | `start.sh` / `start-all.sh` / `status.sh` 均为 **LF**（CRLF 会让 shebang 失效） |
| Windows 绝对路径 | ✅ | 只剩 `lib/browser-path.js`（按 `process.platform` 分支）与 `lib/douyin-qrlogin.js`（已改为按平台给候选）；其余全部 `path.join` |
| 路径分隔符 | ✅ | 上传/产物路径都走 `path.join`；合并榜单文件名用哈希，不会超长 |
| 文件名编码 | ✅ | 产物名含中文（`感谢榜单_…`）在 Linux UTF-8 下正常；Docker 已设 `LANG` 默认 C.UTF-8（node 镜像自带） |
| 浏览器（出图） | ⚠️ 需手动 | 裸机 `npx playwright install --with-deps chromium`；Docker 用 `--build-arg WITH_PLAYWRIGHT=1`（默认不装，省 300MB） |
| 中文字体（出图） | ✅ 已补 | Dockerfile 增加 `fonts-noto-cjk` + `fonts-noto-color-emoji`（debian-slim 默认没有，缺了图上全是方框）；裸机命令写进部署文档 |
| Chromium 可执行位 | ✅ 已处理 | Docker 里 `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright` + `chmod -R a+rX`（默认装在 /root 下，node 用户读不到） |
| better-sqlite3 | ✅ | Docker 用构建阶段编译后整份拷贝；裸机需 Node 20/22 + `python3 make g++` |
| 时区 | ✅ | Docker `TZ=Asia/Shanghai` + `tzdata` + `/etc/localtime`；裸机文档有 `timedatectl` 说明 |
| 非 root 运行 | ✅ | Docker `USER node`，entrypoint 检查 `db/`、`logs/` 可写并给出 chown 提示 |
| Go 代理 | ✅ | 平台二进制命名 + `DOUYIN_PROXY_BIN`；Docker 构建阶段自动下载 linux-amd64 |
| 端口/绑定 | ✅ | Docker `DASHBOARD_HOST=0.0.0.0`、`EXPOSE 9871 1088`；健康检查不校验 401 |
| lsof 依赖 | ✅ | 「重启 Go 代理」用 `lsof` 找 1088 监听进程，Docker 已装 |
| 挂载 | ✅ | `VOLUME /app/db /app/logs`，compose 里是 bind mount；文档写了属主 chown |

补充建议（未做）：给 `deploy/` 加一个 `douyin-monitor.service` 示例文件（文档里已有内联写法），
以及把 Chromium 安装做成构建参数的同时，提供 `docker compose` 的 profile 变体。

---

## 五、验证记录

```
vue-tsc --noEmit                       0 error
eslint（自有代码，排除 prettier）        0 问题
vite build                             通过（dist 已重建）
合并页回归（56 项）                     56/56 PASS
移动端回归（11 项）                     11/11 PASS
mobile-check（两种窄屏 × 全页面）        全部通过
```

---

## 六、后续建议（按性价比）

1. 拆 `lib/routes/combined.js`（低风险、立刻降低 `sessions.js` 复杂度）。
2. 拆 `combined/index.vue` 的弹窗与下载逻辑（改样式最频繁的地方）。
3. 给 `reports/` 加保留期清理（比如 7 天），避免磁盘长期增长。
4. CI 加 `vue-tsc` + `eslint`（只对 `src/views/douyin`、`src/components/core/base`、`lib/` 生效），
   逐步把 prettier 差异收敛，避免一次全仓格式化的大 diff。
5. `--build-arg WITH_PLAYWRIGHT=1` 的镜像在 CI 里跑一次「生成合并报告」冒烟，确认字体/浏览器都在。
