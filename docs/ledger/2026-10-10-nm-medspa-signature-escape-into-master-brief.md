---
id: 2026-10-10-nm-medspa-signature-escape-into-master-brief
title: NM Medspa 的 158 套餐已写进客户资料，以后写对外内容不用再临时找
status: done
owner: agent
decided_on: 2026-10-10
source: session:9d80e738
done_on: 2026-10-10
done_ref: doc:docs/clients/nm-medspa/2026-10-10-messenger-ad-faq-readonly-check.md
verify_by: 2026-10-17
verify_how: 读客户资料表里 NM Medspa 那条在用的记录，产品里要有 Signature Escape、价格 NZD 158、时长 75 分钟、出处写着 PM 口头确认；官网字段应仍为空（客户确实没有官网）
---
PM 2026-10-10 本人确认套餐真实，统筹批准写库；客户没有官网，官网字段刻意留空，不拿主页冒充。
已写入并回读确认，只动了产品这一个字段，其余字段未碰。
可回退成空：`update master_briefs set products = null where id = '60c6cc24-5946-4d82-a0b8-4eaec2d34d4c';`
遗留待办：广告正文要不要补 158（会重过审，单独排期）；库里重复客户「NM Spa」要不要并掉。
