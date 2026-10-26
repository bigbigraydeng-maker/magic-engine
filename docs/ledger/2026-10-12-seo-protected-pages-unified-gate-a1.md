---
id: 2026-10-12-seo-protected-pages-unified-gate-a1
title: 给所有改客户网站的路径装上同一道「保护页」锁，人点按钮改保护页也只有 PM 能改
status: decided
owner: agent
decided_on: 2026-10-12
source: session:4410efec
verify_by: 2026-10-19
verify_how: 合并后在主干查三件事，都成才算成：①git grep meta_cycle_protected_slugs src 只剩 src/lib/seo/protected-pages.ts 一处读取（测试文件不算）；②npx vitest run src/lib/kernel/__tests__/architecture.test.ts 通过数不低于 kernel-architecture.yml 的 MIN_PASSED；③PM 已在 Render 设 PROTECTED_PAGE_OVERRIDE_EMAILS，且用非 PM 账号点保护页 seo-fix 得到 403
---
设计稿 v0.3 + §8 实施差异：docs/specs/2026-10-12-seo-protected-pages-unified-gate-a1-v0.1.md；代码在草稿 PR #2469（A 级，合并要在对话里问 PM；合并后 PM 还要在 Render 设 PROTECTED_PAGE_OVERRIDE_EMAILS）。设计 2 轮 + 实施后 2 轮审查已过。
不做：Oztop 旧任务、标题周循环自动合并、A4 写入对账、批准按钮、名单专用增删入口。
已知欠账（本稿不修，需另开卡）：①seo-fix-orchestrator 用相对路径 import github-client，绕过 Kernel 架构测试；②publish-geo-to-github 站点级注入；③B7 迁移 apply-adapter 时必须带走 clearance 入参并引用本稿。
