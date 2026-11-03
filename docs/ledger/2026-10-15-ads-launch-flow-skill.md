---
id: 2026-10-15-ads-launch-flow-skill
title: 广告发布只有一个入口技能；计划批准、开投、加预算只认 PM 本人；日预算上限为空一律不起草不开投
status: decided
owner: agent
decided_on: 2026-10-15
source: doc:.claude/skills/me-ads-launch-flow/SKILL.md
verify_by: 2026-10-22
verify_how: 技能文件在主干、含两道批准关与空上限规则；下一个客户起草广告时窗口确实按它走，并留有计划批准与开投回执
---
入口技能 me-ads-launch-flow：计划、素材、草稿(暂停)、批准、发布、复盘六步。
计划批准只能 PM 本人批（FDE 不可）；开投与加预算也只认 PM 本人，在执行动作的对话里点名到层。
日预算上限字段为空：不起草不开投，并下发人工任务（what/how/href）。
