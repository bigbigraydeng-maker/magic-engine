# 派工单：118-后台-补入口与合并重复入口

权威依据：`docs/audits/2026-10-17-me-dashboard-structure-audit.md`（基于 origin/main）。
PM 2026-10-17 授权："补入口+合并"。

目标：①给后台首页补导航，挂上 20 个无入口页面；②客户总览页把重复入口收口。
验收：
1. `/dashboard` 能点到：today、kernel-approvals、voice、workflows-health、reports、analytics、conversions、commerce、industry-baselines、team-memory、me2/product-map，以及 admin/ 下 9 页（admin 区块仅管理员可见，沿用现有权限判断，不放宽）。
2. 客户总览页：社媒 6 入口收成 1 个门（daily-plan 为主，其余作为门内次级链接；社媒日常与每日计划同页，只留一张卡）；出片 6 入口收成 1 个门；客人相关（CRM 管理、contacts、business-inbox、messenger、crm 子页）收进 CRM 一个门。
3. 本周新页 sales-progress / business-calculator / promo-plan 归入对应分组。
4. 不删任何页面，不改任何网址，只动链接与卡片分组。`content/generate` 是重定向，保留。
不做：`ad-health` → `ads-health` 改路径（B 级，另开）；不改权限与数据；不顺手重构 me-shell。
风险级：C（界面与链接）。写入者：DeepSeek 默认（CLAUDE.md §5），本窗口 Claude Code 出指令并审 diff。
改动范围：`src/app/dashboard/page.tsx`、`src/app/dashboard/clients/[id]/page.tsx`，及必要的小组件。
验证：type-check、相关测试、`npm run build` 编译阶段、Impeccable detect 前后数字、浏览器截图（首页与客户总览）。
基线必须用 origin/main 最新；统筹窗口的工作区是旧快照，不能当依据。
提醒：改动后用 `git grep` 复核 20 个页面各至少有 1 个入口，写进 PR 正文。
