---
id: 2026-10-18-flywheel-attribution-polarity
title: 广告「线索价涨了」不再被判成好事，没执行过的建议不再被评好坏（改好待上线）
status: decided
owner: agent
decided_on: 2026-10-18
source: doc:docs/specs/2026-10-18-ads-loop-three-fixes-design.md
verify_by: 2026-10-25
verify_how: 合并部署后下次 attribution cron 跑完，只读查 flywheel_outcomes：CTS 的 6 条旧 ads 行仍在；metric_key=ads.account.cost_per_lead 里线索价上涨的动作 computed_at 在部署之后的行不再是 confirmed
---
修复②：新增指标方向表（越低越好 / 中性 / 默认），只在没写 expected_delta 时生效；建议类动作走新出口 not_evaluable，只计数不删旧行不出待办。
查法：select action_id, verdict, delta_pct, computed_at from flywheel_outcomes where metric_key='ads.account.cost_per_lead' order by computed_at desc。旧的 6 条错行不删不改，是否清理由 PM 另批。
