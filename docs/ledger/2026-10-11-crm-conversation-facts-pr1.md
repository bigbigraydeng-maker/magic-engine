---
id: 2026-10-11-crm-conversation-facts-pr1
title: 给 NAL 每段对话存「AI 读出的七个是或否」（只写不读，名单不变）；迁移与开关要 PM 亲口回「合」才上线
status: done
owner: agent
decided_on: 2026-10-11
source: session:f53ba28d
verify_by: 2026-10-18
verify_how: PM 回「合」后合并 → 应用迁移 → 在 Render 配 CRM_FACTS_CLIENT_IDS 为 NAL → 一天后查 conversation_facts 里 NAL 有几十行 status=ready，且每小时任务回执里 conversationFacts.written>0、failed 很少；「先放着」的名单页和今天要联系人数不变
done_on: 2026-10-11
done_ref: pr:2440
---
2026-10-11 已上线：迁移已应用、开关只开 NAL、手动触发第一轮读 5 段写成功 5 段花费约 3 美分。PR1 只写不读：不改名单、不改侧栏。PR2（读取 + 欠报价升进今天要联系，每天最多占 5 个名额、只升 30 天内有动静的）等 PR1 上线跑满一周、PM 抽看事实质量后再做。设计稿与两审处置：docs/specs/2026-10-10-crm-conversation-facts-design-v0.md（在 PR #2421 分支上）。
留给 PR2 的清单（升级条件、名额、B 组已砍、事实不稳要先量一致率、PM 再标 10 个）见 docs/specs/2026-10-11-crm-conversation-facts-pr2-checklist.md。
