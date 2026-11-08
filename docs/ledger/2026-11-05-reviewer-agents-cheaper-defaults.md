---
id: 2026-11-05-reviewer-agents-cheaper-defaults
title: 魏征、子牙做 B/C 级审查改用便宜档并限制读取范围，两周后核对是否真省了
status: done
owner: agent
decided_on: 2026-11-05
source: session:47678e75
verify_by: 2026-11-18
verify_how: 重新统计 11-05 之后新跑的魏征/子牙运行；至少 5 次才能判，不足就写「样本不够」顺延一周。成=B/C 级运行多数用 Sonnet 档、平均每次读写量明显低于 11-05 前的约 360 万；不成=仍是 Opus 档为主，则查是谁派的活没写模型档。
done_on: 2026-11-05
done_ref: pr:3622
---
本机 145 次助手运行记录显示魏征平均每次约 360 万读写量、至少 17/30 次用 Opus 档。
PM 回「省」后，约定写进 docs/agents/90-weicheng.md §九 和 docs/agents/10-ziya.md §十一。A 级复核不降级。
GitHub 自动审查工作流 9-11 起已手动停用，不在本卡范围。
