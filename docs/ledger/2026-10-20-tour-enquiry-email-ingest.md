---
id: 2026-10-20-tour-enquiry-email-ingest
title: 官网团页表单（Tour enquiry）通知邮件也进 CRM：广告落地页的真实线索路径，识别方式与联系表单一致
status: decided
owner: pm
decided_on: 2026-10-20
source: session:96dc6edf
verify_by: 2026-10-21
verify_how: 合并部署后，由统筹用非 CTS 域名邮箱在官网团详情页提交一条内部测试表单；下一轮每小时同步（每小时过 10 分）后读回：回执 formEnquiries 的 recognised/created 各加 1，CRM 里出现该联系人、来源为网站表单、触点渠道 web_form、会话主题「Tour enquiry — 团名」；Facebook click ID 那行不影响解析
---
第一期只认 Contact form，广告落地页走的 Tour enquiry 还收不进；追踪检查的 CRM 门在第二期上线前会因 Contact form 变绿而是假绿。
