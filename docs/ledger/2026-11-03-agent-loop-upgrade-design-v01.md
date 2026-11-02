---
id: 2026-11-03-agent-loop-upgrade-design-v01
title: Agent 闭环升级设计稿 v0.1 写好了（先立基线和考卷，再用广告跑通第一条闭环），等 PM 回「开工」
status: decided
owner: pm
decided_on: 2026-11-03
source: doc:docs/specs/2026-11-03-me-agent-loop-upgrade-design-v0.md
verify_how: PM 回「开工」后进第 0 步；第 0 步结束复跑 scripts/agent-loop-baseline.sql，并把至少 5 道有确认答案的考题写进现有广告回放测试，才算第 0 步完成
---
设计稿：docs/specs/2026-11-03-me-agent-loop-upgrade-design-v0.md（已吸收魏征复审 14 条）。
基线 B0（11-03 实测）：90 天里，SEO 和社媒的动作没有一条判出有效或无效；规则型决策点 0/5 会读上次结果。
本卡只记设计已定。第 0 步实现另开改动单，那时再新建一张卡。
