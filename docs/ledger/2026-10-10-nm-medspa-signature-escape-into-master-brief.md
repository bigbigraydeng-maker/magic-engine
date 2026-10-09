---
id: 2026-10-10-nm-medspa-signature-escape-into-master-brief
title: NM Medspa 的 158 套餐要按产品字段规范（名称+卖点）重写进客户资料
status: decided
owner: agent
decided_on: 2026-10-10
source: session:9d80e738
verify_by: 2026-10-17
verify_how: 读客户资料表里 NM Medspa 那条在用的记录，产品里每条只有「名称 + 卖点」两个字段，卖点文字里含 Signature Escape、NZ$158、75 分钟、出处 PM 口头确认，且没有价格/币种等多余字段；官网字段应仍为空（客户确实没有官网）
---
PM 2026-10-10 本人确认套餐真实，统筹批准写库；客户没有官网，官网字段刻意留空，不拿主页冒充。
之前写入的一版带了多余字段（价格/币种等），系统读不出卖点、Settings 保存还会删掉，需按 {name, usp} 重写（写库须另获授权）。正确内容见 doc:docs/clients/nm-medspa/2026-10-10-messenger-ad-faq-readonly-check.md §7。
可回退成空：`update master_briefs set products = null where id = '60c6cc24-5946-4d82-a0b8-4eaec2d34d4c';`
遗留待办：广告正文要不要补 158（会重过审，单独排期）；库里重复客户「NM Spa」要不要并掉。
