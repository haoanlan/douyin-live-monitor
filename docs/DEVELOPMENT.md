# 开发指引

## 环境

- Node **20.19+**（推荐 22.x；Windows 发布包必须 22.x，原生模块按大版本绑定）
- 可选：Chromium（图片报告用，`npx playwright install chromium` 或系统 Chrome/Edge）

## 常用命令

```bash
npm install                                   # 后端依赖
cd frontend && npm install && npm run build   # 前端依赖 + 构建（含 vue-tsc 类型检查）
npm test                                      # 单元测试（node:test，无需额外框架）
node web-dashboard.js                         # 启动（worker 已内嵌）
node scripts/build-release.js                 # 打 Windows / Linux 发布包
```

## 目录速览

| 路径 | 内容 |
| --- | --- |
| `lib/routes/` | HTTP 接口（sessions / detail / trends / combined …） |
| `lib/worker/` | 采集实现（消息解析、刷库、场次收尾） |
| `frontend/src/` | Vue 3 看板源码 |
| `assets/` | 榜单图片渲染素材（`thanks-rank.js` 内联使用） |
| `deploy/` | systemd 部署文件 |
| `test/` | 单元测试 |

## 数据口径（改代码前必读）

1. **连击去重按场次分组**：分组键 `(用户, 礼物名, 收礼人, 场次)`；跨场次查询的 SELECT 必须带 `session_id`，否则会退化成跨场次合并。
2. **汇总读预聚合表**：总览与合并页读 `session_*` 表，不扫全量明细（明细 40 万行级）。
3. **明细走独立接口**：全量礼物明细在 `/api/sessions/:id/gift-details`，详情接口只带最新 200 条。

## 不要提交的构建产物

`frontend/dist/` · `frontend/src/assets/iconify/offline-icons.json` ·
`frontend/src/types/import/*.d.ts`（均已在 `.gitignore`，构建时自动生成）
