---
id: 2026-11-10-distributor-apply-page-built-without-lawyer
title: 经销商对外申请页先做出来，不等律师看合规（PM 11-10 回「现在就做」）
status: decided
owner: pm
decided_on: 2026-11-10
source: session:e5aca2ac
verify_how: 数据库表生效后，用手机打开 /partner/apply 填一份测试申请，后台经销商页出现一条「自己申请」的待审核记录、第二天今日待办出现「有 1 个人申请做经销商」，两件都对才算成；测完在后台点「拒绝」。同时在线上日志搜 `[distributor-apply] source headers`，确认 cf=true（或 xff_hops 的最右一段是访客地址而不是服务器自己的地址），否则「同一来源每小时 3 份」会把所有人算成同一个来源。
---
申请页只会生成「待审核」经销商，批不批仍在后台由人点。页面写明加入免费、收入只来自真实客户付费、不保证收入。
没请律师看过：新西兰和澳洲都禁止靠拉人头赚钱的模式，现在的规则是按销售额分钱，但正式大规模招募前仍建议找当地律师过一遍条款。
