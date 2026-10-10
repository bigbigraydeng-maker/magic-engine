---
id: 2026-10-08-price-claim-recognition-no-currency-symbol
title: 价格识别补漏：没写币种符号的旅游报价（from 2,699 per person、3,499pp、only 2699）现在也会被价格闸认出
status: decided
owner: agent
decided_on: 2026-10-08
source: session:cf1e84bd
verify_by: 2026-10-15
verify_how: 合并上线后，看价格闸拦下的帖子里有没有把正常文案（年份、人数、公里数）误判成价格的反馈；没有就保持
---
PM 2026-10-08 回「修识别」。只改共享的价格识别（严、宽两个口径同步），不动发布路由；金额至少 3 位或带千分位，排除年份与人数、公里等单位。
当场验证：生产库 510 段真实文案新旧两版判定 0 条变化（无误伤）；去掉新规则，6 条新增用例全红；全仓 87 条失败与主干基线完全一致。
