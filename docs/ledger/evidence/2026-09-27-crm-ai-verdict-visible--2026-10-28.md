# 证据 · 2026-09-27-crm-ai-verdict-visible · 2026-10-28
fetched_at: 2026-10-28T21:34:33+1300
查了什么：按 verify_how 跑 scripts/probe-crm-stage-actor-label.ts（生产库只读，worktree=origin/main 405b3cc9f）
数字：生产库阶段变更共 1371 条；ai:conversation-read 1180 条，1180/1180 带理由（100%，门槛 ≥95%）；每种「谁改的」（ai:conversation-read / system:call-reached / system:new-lead / PM-2026-10-06 via claude 等）都翻成人话、无冒号；带客人原话 756 条，剥开头后原话还在 756 条；脚本结论「全部通过」，退出码 0
来源/命令：npx tsx --env-file=<主仓库 .env.local> scripts/probe-crm-stage-actor-label.ts
结论：成。每种身份都有人话翻译，AI 判断理由比例 100%。
