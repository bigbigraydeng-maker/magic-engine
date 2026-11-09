---
id: 2026-11-05-social-agent-downgrade-and-cap-at-execution
title: 社媒 Agent 计划 §4 的自动降级 / 升级统计、每日上限与平台 24 小时 30 条在执行前当场核，第 2 刀没做
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-social-agent-high-frequency-facebook-dev-plan-v1.md
verify_by: 2026-11-19
verify_how: 每日清单跑满 14 天时，flywheel_actions 里 social_daily_list_decision 行能算出「剔除数 / 事后撤回数」；若 PM 要从每日清单改每周清单，这张卡必须先做完；执行器 cloud-reel-scheduled-go-public 公开前读不读客户每日上限与近 24 小时已发条数（现在不读）
---
现在每客户每天最多排 1 条，平台 30 条 / 24 小时到不了；放行与剔除都有回执，作为以后升级 / 降级的证据。要升到每天 2 条或每周清单之前必须补上。按 §11：频率 中 · IMPACT 高 · 收入 中 → P2。
