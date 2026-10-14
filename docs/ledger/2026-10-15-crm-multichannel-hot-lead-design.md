---
id: 2026-10-15-crm-multichannel-hot-lead-design
title: CRM 多渠道「热客」判断设计稿（建在 10-10 标准与事实表之上；分三步，第一步只显示不改名单）
status: decided
owner: agent
decided_on: 2026-10-15
source: session:ac16fd7f
verify_by: 2026-10-22
verify_how: 子牙 + 魏征两审意见并入后交 PM；PM 回「合」才开实现 PR。第一步算不算做完，逐条核这七项（缺一条即未完成）：① 设计稿在 main 上；② src/lib/crm/facts/io.ts 渠道白名单含 email；③ 自动回复 / 群发打开点击行在进事实推断前已过滤；④ 候选改成按客户×渠道分页取、能翻过 400 段；⑤ buildFactsPrompt 已抽成行业配置且旅游样例回归通过；⑥ 邮件按 message_id 取全文（或已在稿里明确收窄为只认摘要）；⑦ 四项事实各有来源消息序号，且单次运行有成本上限并留回执。另核两张名单的人数与顺序快照与上线前一致。只读查，结果不写进本卡
---
结论与依据见设计稿 docs/specs/2026-10-15-crm-multichannel-hot-lead-design.md（客户级统计只放在设计稿与受控审计记录，不放台账）。
本卡只跟踪：设计稿是否合入、第一步是否开工，验证动作见上方 verify_how。
