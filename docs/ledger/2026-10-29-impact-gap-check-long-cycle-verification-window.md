---
id: 2026-10-29-impact-gap-check-long-cycle-verification-window
title: 事件促销场景缺口（核对段）：高客单价生意的验证窗口要比活动长，成交没回填就记「未知」
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-impact-gap-three-layer-event-campaign.md
verify_by: 2026-12-15
verify_how: 事件结束后按事先定的窗口读线索、到店、成交；成交没有回填或接入时，结果必须是 UNKNOWN，不能算成功或失败；核对结论注明季节与并行动作；若活动结束时仍无成交数据，开补数据来源的实现卡。
---
平台层：到期核对机制（台账加夜巡）、UNKNOWN 规则、注明季节与并行动作。行业层：长销售周期的核对窗口默认值（候选）。企业层：到店与成交的回填，或开放系统读取。
验证日要在开投前就写好，不得活动结束后再补。
