---
id: 2026-11-25-crm-enquiry-daily-digest
title: 每天早上 8:15 发「昨天进来几个咨询、各问什么」早报；先只发 ME 自己信箱，PM 看准了再改发 CTS 的 info 信箱
status: done
owner: agent
decided_on: 2026-11-25
done_on: 2026-11-25
done_ref: commit:7e2beb9e7
source: session:15a4b338
verify_by: 2026-11-28
verify_how: 合并上线并打开开关 ENQUIRY_DAILY_DIGEST_ENABLED=true 后，第一次自动运行当天 8:15 hello@magicengine.cloud 收到 CTS 早报；运行记录 crm-enquiry-daily-digest 一行成功；信里人数与后台当天 Facebook 表单 + 官网表单人数一致
---
PM 11-25 要求：每天自动总结昨天进来的 enquiry 数量和大概内容，发给 info。
现在：只算 Facebook 表单和官网表单；私信 / WhatsApp 单独列不计数；不含邮件和电话；ME 自己的测试线索排除。
11-25 当场试跑：读正式数据、只发 hello@ 两封样信，发信服务回执都有。
还差：①上线后由 PM 同意在 Render 打开开关；②PM 看几天样信说准，再改代码把收件人换成 CTS 的 info 信箱（A 级外发，要 PM 本人确认）。
