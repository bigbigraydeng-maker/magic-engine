---
id: 2026-11-25-crm-enquiry-daily-digest
title: 每天新西兰早上 7 点自动给 CTS 的 info 信箱发「昨天进来几个咨询、各问什么」早报
status: done
owner: agent
decided_on: 2026-11-25
done_on: 2026-11-25
done_ref: pr:3933
source: session:15a4b338
verify_by: 2026-11-26
verify_how: 上线后第一个早上 7 点，运行记录 crm-enquiry-daily-digest 有一行成功且 CTS 那条 sent=true 带发信编号；信里人数与后台前一天 Facebook 表单 + 官网表单人数一致；CTS 确认 info 信箱收到
---
PM 11-25 原话：「每天自动提醒昨天进来多少 enquiry，大概是关于什么，总结发给 info」，随后「每天早上 7 点自动跑，然后发邮件给 info 的邮箱」。
只算 Facebook 表单和官网表单；私信 / WhatsApp 单独列、不计数；不含邮件和电话；ME 测试线索排除；正文不带客人电话邮箱。
收件人写死在代码里（CTS → info@ctstours.co.nz），加客户要改代码；紧急停发：Render 设 ENQUIRY_DAILY_DIGEST_PAUSED=true。
11-25 当场试跑：读正式数据、发 hello@ 两封样信，发信服务回执都有。
