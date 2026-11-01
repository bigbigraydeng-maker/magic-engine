---
id: 2026-11-02-publishing-quota-weekly-format
title: 发布名额可以按周写，旧的按天配置在开关打开前不变
status: decided
owner: agent
decided_on: 2026-11-02
source: doc:docs/specs/2026-11-02-publishing-quota-weekly-example.md
verify_by: 2026-11-09
verify_how: 开关未设时，仍是按天名额的客户页面不变；开关严格为 true 且写入按周数字后，本周总览 Story 显示每周名额。迁移文件仍标未执行，且没有客户行被改写。
---

按周名额和按天名额可以写在同一份客户配置里。开关没开时，只认原来的按天数字。
开关必须严格等于 true，按周数字才盖过按天。例子在文档里，没有写进任何客户。
迁移文件只补列、不改行，这份草稿没有执行。
指针：docs/specs/2026-11-02-publishing-quota-weekly-example.md
