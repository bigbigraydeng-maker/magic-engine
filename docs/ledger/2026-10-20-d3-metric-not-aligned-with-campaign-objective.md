---
id: 2026-10-20-d3-metric-not-aligned-with-campaign-objective
title: D3「花钱没结果」按客户级主结果（留资）判，投放目标不是留资的系列（如官网点击）会被判成零结果——长期要让判据口径跟投放目标对齐
status: decided
owner: agent
decided_on: 2026-10-20
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 对一个目标是官网点击（LINK_CLICKS）的系列开投后，次日读 ad_health_narratives 的 D3：不应再因 leads=0 命中「花钱没结果」，或命中时原文明确按该系列自己的目标算。对齐前，命中只算「已知口径不匹配」，不算 Agent 缺陷（18 号 2026-10-20 裁定）。
---
d3-spend-no-result.ts 用客户级 primary_result（CTS 是 lead，目标成本 $11）逐广告组算每结果成本，零结果也算命中。
CTS 的 A 方案目标是 LINK_CLICKS，广告组 leads 会一直是 0；开投后近 7 天花费超过 $22 就可能命中，这不是真问题。
演练模式下命中只记 dry_run_logged，不会真暂停；这不是开投阻塞，开投后观测时命中就写一行观测记录注明原因。
长期做法属于「判据口径跟系列目标对齐」，按冻结令不在本轮做；owner agent，排在开投后。
