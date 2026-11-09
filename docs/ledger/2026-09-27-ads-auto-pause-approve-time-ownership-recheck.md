---
id: 2026-09-27-ads-auto-pause-approve-time-ownership-recheck
title: 广告自动暂停在「批准」那一刻用 Meta 实时数据再核一次广告组是不是这个客户的（后续事项，未排期）
status: decided
owner: agent
decided_on: 2026-09-27
source: session:b487d1fb
verify_by: 2026-10-25
verify_how: 查批准执行暂停的代码路径（capabilities/ads-auto-pause）在调 Meta 暂停前有没有实时读这个广告组名下广告的创意主页并与客户登记主页比对、以及核对广告组属于提交时的广告账户；有且有测试锁住算成
---
魏征 2026-09-27 实施复审建议：提交时已核过归属，但待批准的暂停可能挂几天，期间组里可能混进别家广告；执行那一步只按广告组编号暂停，不核对它属于哪个广告账户。
今天只有一个客户开着自动暂停且仍是只记账模式，风险暂时为零；打开真出手之前应先做这张卡。
来源设计稿：docs/specs/2026-09-27-ads-diagnostics-client-page-scope-design.md §6。
