---
id: 2026-11-05-social-schedule-avoid-repeats
title: 社媒 Agent 第 2.5b 刀：每天排期自动避开连发同模板、一周内同一首曲子、同一条片的改版
status: decided
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-social-agent-account-self-check-loop-v0.1.md
verify_by: 2026-11-09
verify_how: 合并部署后 CTS 跑一次排期演练：新排进去的日子里没有连续三条同模板、七天内没有同一首曲子、七天内没有同一条片的两个改版；排不进去的片在回执里写了原因（music_repeat、variant_crowd、template_run）；11-09 周一自检回执里这几项不比 11-05 基线更差
---
排期规则只用账号自检同一套口径；没有风格信息的片不被拦（查不到不等于违规）；候选都一样时按原顺序排，不会因此排不出片。
