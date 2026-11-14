---
id: 2026-10-18-order-provenance-rule
title: 出片下单过渡规则：每张工单必须带「来源 + 谁授权 + 需求单号」，等素材需求单上线后再接自动下单
status: decided
owner: agent
decided_on: 2026-10-18
source: session:ec90bb17
verify_by: 2026-10-25
verify_how: 抽查近 7 天新增的 manual_remotion_* 工单，angle_source 里必须同时有 source、authorized_by，且有需求单号字段（105 号需求单字段定下来后补；在此之前写台账卡 id 作为替代）。缺任何一项视为不合格下单。
---
现状：近 30 天约 90 张 Remotion 工单全是人工塞的（manual_remotion_*），自动排产没有任何客户开启，且自动路径产不出 Remotion 单。零代码过渡：angle_source 必带 source + authorized_by + 需求单号（缺则写台账卡 id）。需求单落 content_demand_signals.request 并让 evaluate 能建 Remotion 单属 A 级（碰建单/花钱路径），只上报，等 105 的需求单字段定了再对齐。详见 docs/clients/cts/2026-10-18-production-line-loop-register.md。
