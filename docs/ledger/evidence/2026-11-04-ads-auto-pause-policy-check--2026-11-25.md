# 证据 · 2026-11-04-ads-auto-pause-policy-check · 2026-11-25
fetched_at: 2026-11-25T03:22:03+13:00
查了什么：Supabase SELECT count on action_runs, authorization_decisions (action_key and deny_code over 90d), flywheel_actions payload
数字（带样本量、两边取数状态）：action_runs with ads.auto_pause_on_d3: 0 rows; authorization_decisions with that key: 0; deny_code outward_requires_human_policy in last 90 days: 0; flywheel_actions blocked/auto_pause_on_d3 rows: 0. Note: both CTS and NAL policy rows for this action are now require_approval (v5 and v2), no longer auto_approve.
来源/命令：见「查了什么」，均为只读查询
结论：成，11-25 只读查生产库，三条判据都是零行，雷没被踩。
