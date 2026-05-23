---
检查日期: 2026-05-23
状态: 待修复（token reset 后处理）
---

# Magic Engine 健康检查 — 待修复清单

## 🔴 优先级1 — 立刻处理

### ① 安全漏洞：`/api/ai-tracker/run-dashboard` 无鉴权
- 任何人可触发 AI Tracker 全量运行（高 API 成本风险）
- 修复方案：合并 `codex/p8-3-2-magic-link` 分支，或临时加 `INTERNAL_API_KEY` 校验
- 关联任务：P8.3.2

### ② 待 merge 的功能分支（代码已完成，ROADMAP 未勾选）
| 分支 | 内容 | 文件数 |
|---|---|---|
| `feat/phase-12-i-execution-autonomous-lane` | P12.I.6 自主行动泳道 + I.7 一键生成博客 + I.8 关键词快照 Cron | 19个文件 |
| `feat/phase-12-j-hero-html` | P12.J.2 头图注入 HTML | 7个文件 |
| `feat/phase-12-i7-generate-blog` | P12.I.7 备用分支 | 4个文件 |
| `codex/fix-blog-post-save` | 博客保存 fallback 修复 | — |

操作：逐一 review → merge 到 main → 在 ROADMAP 勾选对应 checkbox

## 🟡 优先级2 — 近期处理

### ③ Reels brief 格式化丢失视觉DNA
- `reels/generator.ts::formatMasterBriefForPrompt()` 是弱类型简版，缺 vi_* 视觉品牌字段
- 修复：改为调用 `brief-injector.ts::formatBriefForPrompt()`
- 影响：Reels 图片/视频生成时缺少品牌色系和视觉风格约束

### ④ ARCHITECTURE.md 严重滞后（最后更新 2026-05-03，落后20天）
需补充：飞轮架构、DataForSEO 接入、Phase 12 新数据表、第三方服务封装名

### ⑤ PRODUCT_OVERVIEW.md 落后10天
未反映 Phase 12 最新模块状态

## ⚪ 优先级3 — 低优先级技术债

### ⑥ SDK 模块级初始化违规（违反 CLAUDE.md 规范）
- `src/lib/ai/generate.ts` 第8行
- `src/lib/content/route-b-rewriter.ts` 第6行
- `src/lib/content/video-analyzer.ts` 第45行

### ⑦ 月报聚合器两套并存（旧: lib/reports/ 新: lib/monthly-report/）

### ⑧ Route A / Route C 可合并为带 mode 参数的单一路由
