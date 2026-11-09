---
id: 2026-10-05-messenger-reply-rate-readonly-metrics
title: 私信回复率与 24 小时回复率：只读计算、不建新表，机器回复和系统通知不算我们回复
status: decided
owner: agent
decided_on: 2026-10-05
source: session:1371db1a
verify_by: 2026-10-12
verify_how: 提交已开出且单测通过；用 CTS 近 30 天真实对话（样本量写在提交说明里）把新口径当场算一遍，数字和手工 SQL 对得上才算成
---
口径：客户先发话的对话里，真人（或经 ME 发出的人工回复）在 24 小时内回复的比例；机器自动回复与 ME 自动安抚单独统计。
库里没存 Meta 的来源标签，真人是按已有规则推断的，报告里要写明这一点。是否接进日报由 PM 另行决定。
