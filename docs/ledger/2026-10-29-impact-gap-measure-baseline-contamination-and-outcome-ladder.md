---
id: 2026-10-29-impact-gap-measure-baseline-contamination-and-outcome-ladder
title: 事件促销场景缺口（量化段）：开投前要能识别「相邻促销污染了基线」，并定义线索到成交的指标阶梯
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-impact-gap-three-layer-event-campaign.md
verify_by: 2026-11-05
verify_how: 查 Measure 能否在没有可信基线时输出 UNKNOWN 而不是估数；能否检测近期促销对基线的污染；指标阶梯（线索、接通、到店、成交）的取数来源是否有人负责；缺哪项开实现卡，并写清平台、行业、企业哪层负责。
---
平台层：基线污染检测、UNKNOWN 规则、验证窗口按销售周期定（疑似 L1 扩展，候选未登记）。行业层：指标阶梯和各级常用样本量（单样本，候选）。企业层：各级取数口径、谁填、多久填一次。
追踪是否把留资回传给广告平台未验证，属本卡验收的一部分。
