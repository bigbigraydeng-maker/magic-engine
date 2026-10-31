---
id: 2026-11-01-model-tiering-rule
title: 派活按 L0–L4 分层选模型（便宜模型写代码，Opus 只做最高风险级设计与审查）
status: decided
owner: pm
decided_on: 2026-11-01
source: session:96dc6edf
verify_by: 2026-11-08
verify_how: 抽查 11-01 之后的 5 个最高风险级 PR：正文是否有「派活等级 / 写代码模型」一行；偏离默认的是否写了原因；本周统计用了 L4 的活是否名副其实
---
背景：PM 贴了 Grok 云端开发模型分配办法（用量消耗太快），要求参照设计 Claude 窗口的分层规则。10-29/30 本窗口大部分代码由 Claude 助手写，没按「默认 DeepSeek 写」走，也没在 PR 写原因。
规则：L0 自己做 / L1 杂活 DeepSeek+Haiku / L2 普通 DeepSeek 写 Sonnet 审 / L3 A 级修复 DeepSeek 写 Opus 审 / L4 A 级新做 Opus；A 级审查用子牙+魏征（不请 Codex）；产品线上判断用 Haiku 5.5。写入 CLAUDE.md §5。
