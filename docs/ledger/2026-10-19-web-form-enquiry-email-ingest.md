---
id: 2026-10-19-web-form-enquiry-email-ingest
title: 网站联系表单通知邮件进 CRM：识别 info@ 发给 info@ 的 Contact form 通知，取 Reply-To 的客人邮箱建人并记一条网站表单触点
status: decided
owner: pm
decided_on: 2026-10-19
source: session:96dc6edf
verify_by: 2026-10-21
verify_how: 合并部署后，让 CTS 员工用非 CTS 域名邮箱在官网联系页提交一条内部测试表单；等下一轮每小时同步（NZ 整点过 10 分）后读回：CRM 里出现该联系人、来源为网站表单、触点渠道 web_form；每小时同步回执里 formEnquiries 的 recognised/created 计数对得上；Baker 这类 CTS 域名邮箱的测试单仍不进客人名单（计入 staffTest）
---
上线前已到的表单咨询（含孤儿会话）回补是写生产库，另出方案与数量，等 PM 点头。Tour enquiry 类没有样本，本版不含。
