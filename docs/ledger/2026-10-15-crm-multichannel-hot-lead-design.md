---
id: 2026-10-15-crm-multichannel-hot-lead-design
title: CRM 多渠道「热客」判断设计稿（建在 10-10 标准与事实表之上；分三步，第一步只显示不改名单）
status: decided
owner: agent
decided_on: 2026-10-15
source: session:ac16fd7f
verify_by: 2026-10-22
verify_how: 子牙 + 魏征两审意见并入后交 PM；PM 回「合」才开实现 PR。查三件事：① docs/specs/2026-10-15-crm-multichannel-hot-lead-design.md 在 main 上；② src/lib/crm/facts/io.ts 的渠道白名单是否已含 email（没含＝第一步没做）；③ 邮件渠道是否已有事实行（只读查，结果不写进本卡）
---
结论与依据见设计稿 docs/specs/2026-10-15-crm-multichannel-hot-lead-design.md（客户级统计只放在设计稿与受控审计记录，不放台账）。
本卡只跟踪：设计稿是否合入、第一步是否开工，验证动作见上方 verify_how。
