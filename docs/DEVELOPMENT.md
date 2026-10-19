# 开发说明（内部）

> 这份文档面向**改这个项目的人**：自检脚本、数据口径、容易踩的坑。
> 想了解"怎么用"，看 [README.md](./README.md)；想知道表结构，看 [DATABASE.md](./DATABASE.md)。

## 口径与约定（容易踩的点）

### 弹窗 / 抽屉

- **右上角统一用 Element 标准 X**（内容放 `#header` 插槽，不要自绘关闭按钮 ——
  自制按钮的位置、尺寸、悬停态都和别处不一样，看着像两个产品）。
- **弹窗保留「取消」**：footer 左侧「取消」（`text` 样式）+ 右侧主操作，与 X 等价，
  但符合表单/确认弹窗的使用习惯。**抽屉不放「取消」**（关抽屉有 X 就够了，
  配置抽屉按此约定）。
- 按钮要"转圈不跳宽度"，用 Element 自己的 `:loading` + 固定 `min-width`；
  **不要**塞一个 `class="invisible"` 的图标来占位 —— 那会在文字左边留一段空白
  （实测用户一眼就看出"两个按钮有空白占位"）。
- 遮罩点击统一禁用（`close-on-click-modal="false"`），避免误触把表单关掉；Esc 可关闭。
- 不要为了自绘布局去覆盖 `--el-dialog-padding-primary` / `.el-dialog__body` 内边距：
  实测那样会把 header 压成 24px 高，而标准 X 是 48px，X 会有 24px 压进 body（点不中）。

### 数据

- **礼物连击去重按"场次"分组**：分组键是 `(用户, 礼物名, 收礼人, **场次**)`。
  不带场次时，同一个人在不同场次送同一礼物会被判成"同一段连击"而少算（实测差 0.057%）。
  调用方若做**跨场次**查询，`SELECT` 里必须带 `session_id`，否则分组会退化成旧的跨场次合并。
- **粒度保留**：只到日的地方用 `fmtDate`（`2026/10/14`），到分钟的地方用 `fmtTime`（`2026/10/14 12:00`）——
  两者是刻意分开的两种粒度，只是共用同一份解析实现。
- **总览页读预聚合**：`/api/overview` 由"已结束场次 SUM(agg_*) + 直播中场次实时补算"得出，
  不再每次扫全量明细（原来是 41 万行 / 约 5.5 秒的同步计算）。
- **场次详情接口拆分**：`/api/sessions/:id/detail` 只带"最新 200 条"礼物（供动态时间线），
  全量明细（实测 7000+ 条 / 3MB+）走 `/api/sessions/:id/gift-details`，只在打开明细弹窗时拉取。


## 自检脚本

改完代码可以按需跑这些（都需要相应服务已启动）：

```bash
node scripts/sfc-check.js          # 所有 .vue 的模板编译（标签配平、指令语法；比 build 快得多）
node scripts/vite-module-check.js   # 前端模块编译（205+ 源文件）
node scripts/import-check.js        # 所有 import 目标是否存在
node scripts/ui-regression.js       # 桌面回归 10 项（含浅色模式 AA 对比度全量采样）
node scripts/mobile-check.js        # 移动端巡检（溢出、挤压、触控目标）
node scripts/transition-check.js    # 页面切换：无"白纱"、无两页交叠
```

> `sfc-check.js` 是必需的：`vue-tsc --noEmit` **不检查模板结构** ——
> 实测删掉一层 `<div>` 却留下 `</div>` 时，类型检查仍然 0 错误，而 Vite 直接编译失败
> （页面被错误遮罩盖住）。类型检查通过 ≠ 页面能跑。

`scripts/` 下另有 20 余个诊断/审计脚本（数据库体检、接口断言、页面截图对比等），按需取用（当前共 27 个 `.js`）。

## 文档导航

| 文档 | 说明 |
| --- | --- |
| [README.md](./README.md) | 本文件：功能、架构、安装、启动、数据表、口径约定、API 速览、自检脚本 |
| [docs/DATABASE.md](./docs/DATABASE.md) | 16 张表的字段与口径（分析时以它为准） |
| [docs/websocket-fields-ref.md](./docs/websocket-fields-ref.md) | Go 代理推送的 WebSocket 字段参考 |
| [deploy/DEPLOY-linux.md](./deploy/DEPLOY-linux.md) | Linux 部署（含字体 / Chromium 依赖） |
| [PRODUCT.md](./PRODUCT.md) | 产品定位与范围 |
| [docs/archive/](./docs/archive/) | **历史归档**：早期审计、HANDOFF、一次性 spec/团队文档 —— 内容已脱节，仅供追溯 |

