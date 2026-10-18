---
id: 2026-10-18-flywheel-attribution-polarity
title: 广告「线索价涨了」不再被判成好事，没执行过的建议不再被评好坏（改好待上线）
status: decided
owner: agent
decided_on: 2026-10-18
source: doc:docs/specs/2026-10-18-ads-loop-three-fixes-design.md
verify_by: 2026-10-25
verify_how: 合并部署后下次 attribution cron 返回里 not_evaluable>0，且 CTS 6 条旧 ads outcome 行未被删除
---
修复②：新增指标方向表（越低越好 / 中性 / 默认），只在没写 expected_delta 时生效；建议类动作走新出口 not_evaluable，只计数不删旧行不出待办。
旧的 6 条错行不删不改，是否清理由 PM 另批。
