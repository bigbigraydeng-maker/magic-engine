---
id: 2026-10-05-contact-form-no-limit-email-relay
title: contact 表单没有限流/人机验证，且某类表单会给任意填写的邮箱发确认邮件
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后写单测证明坏请求被拒，并在本地起开发服务手动试一次（不碰生产）
---
路径 src/app/api/contact/route.ts（POST）。formType=meta_ads_ai_pilot 时会向用户填的地址发品牌确认信，可被当垃圾邮件中继。
修法：限流 + 人机验证 + 收件人频控。
