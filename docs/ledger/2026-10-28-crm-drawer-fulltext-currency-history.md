---
id: 2026-10-28-crm-drawer-fulltext-currency-history
title: CRM 客人抽屉三处修正：「上次说到这」邮件只有 255 字被截断、AI 概况把纽币写成美元、过往往来默认全折叠看不到
status: decided
owner: pm
decided_on: 2026-10-28
source: session:96dc6edf
verify_by: 2026-11-04
verify_how: 部署后打开 CTS 客人 nicole grimme 的抽屉：「上次说到这」应显示她 10-27 那封信的完整内容（含 Kerikeri Rotary 那几句）；往来记录应直接露出最近 5 条；电话旁显示「新西兰号码」。等她的 AI 概况下次重新生成后，金额应写纽币而不是美元
---
上次说到这：对最新一封客人来信单独去邮箱拉全文并去掉引用历史，拉不到就退回 255 字摘要，不挡抽屉。
AI 概况提示词按 clients.country 带币种规则（NZ→NZD，AU→AUD，国家没填就不加规则）；往来记录折叠时默认露出最近 5 条，更早的折叠。
抽屉电话旁按区号标哪国号码，认不出不标。
当场试跑：本机用线上邮箱对 nicole 10-27 那封信拉全文，481 字完整返回。旧 AI 概况要等该客人有新消息触发重生成才会改币种。
