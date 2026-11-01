---
id: 2026-10-28-lesson-auto-judge
title: 经验自动评判：AI 自己对照试验并给「建议采用 / 不建议」结论，只记录结论，不启用任何经验
status: decided
owner: pm
decided_on: 2026-10-28
source: issue:3088
verify_by: 2026-11-04
verify_how: 合并部署后，Ray 在 /dashboard/ad-engine 点「让 AI 全部试一遍」，每条待试经验顶部出现 AI 结论；今日已花不超过 1 美元；所有经验的启用开关状态不变
---
Ray 反馈手动「试一下 + 采用/不要」太繁琐。做法：每条未启用、在试验名单内、还没有结论的经验，跑 2 轮"没有/有经验"对照，每轮 1 次裁判（A/B 位置交换）；两轮都判"有经验更好"才建议采用。结论只写进 `global_learned_lessons.evidence.ai_verdict`（已有列，无迁移），绝不改 `is_active`。花费沿用 1 美元/天持久化账本，裁判调用一并预留与结算。风险级别 B。未做：定时任务、结论过期重测。
