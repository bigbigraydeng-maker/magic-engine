---
id: 2026-10-27-huatuo-ad-plays-first-real-generation-check
title: 华佗提示词变长后，核对第一次真实生成的处方：有没有产出广告打法、有没有被截断
status: decided
owner: agent
decided_on: 2026-10-27
source: pr:3199
verify_by: 2026-11-03
verify_how: 3199 合并后的第一个周二（周二任务会生成处方）之后，用只读 SQL 查 `prescriptions` 表里该次新生成的处方（按 `generated_at` 取最新、`status='draft'`）：①`content->'phases'` 是不是 JSON 完整可解析、`phases` 个数与 `kpi_targets`、`budget_allocation` 是否都在（缺尾巴、phases 少于 3 个、`narrative` 或 `summary` 为空，都算疑似被截断）；②广告类处方的 `content->'phases'->N->'initiative_seed'->'ad_plays'` 有没有值，值里的 `step_key` 是否全是 `p<阶段>-<序号>-<打法>` 形状、`play` 是否在打法清单内；③生成日志里搜 `[huatuo] ad_plays dropped`，数一数被丢的阶段与原因；④若有 token 用量记录（`ai_usage` 一类表），看这次输出 token 是否贴着上限。以「提示词多了约 390 个 token」为背景：疑似截断的比例 > 0 就开修复卡（调大输出上限或精简提示词）。三条判据都满足才算 verified。
---
3199 把华佗两份系统提示词各加长约 973 字符（约 390 token，按字符数/2.5 粗估）。上线前没有调真实 LLM 量截断率（要花 AI 费用并需要真实诊断输入），所以把核对放在第一次真实生成之后。周二任务每周二 08:00Z 生成处方，首次生成在 3199 合并之后的第一个周二；日期 11-03 是保守取值，若 3199 合并晚于 10-27，则以合并后第一个周二为准并改本卡的 verify_by。

**更正（2026-10-28）**：本卡验证说明里把「phases 少于 3 个」当作截断信号是错的（2026-10-27 真实输出只有 2 个阶段、内容完整，会误报），且没有耗时检查。请以新卡 2026-10-28-huatuo-generation-latency-truncation-check 的判据为准；本卡的验证说明属于冻结字段不能改写，主干台账规则又不许删除 decided 状态的卡，所以保留本卡、在此更正。到期核对时两张卡一起处理，以新卡判据为准，核完把两张卡一起收尾。
