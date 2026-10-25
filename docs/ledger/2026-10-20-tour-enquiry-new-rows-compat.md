---
id: 2026-10-20-tour-enquiry-new-rows-compat
title: 官网表单通知邮件新增「出发时间」「每人预算」两行之前，先确认 CRM 邮件解析器遇到多出的行不出错、缺这两行（旧页面）也正常
status: decided
owner: pm
decided_on: 2026-10-20
source: session:96dc6edf
verify_by: 2026-10-23
verify_how: 官网新表单上线后，由统筹用非 CTS 邮箱提交一条内部测试；下一轮每小时同步读回：回执 formEnquiries 的 parsed 加 1、没有新增 failed，联系人和 web_form 触点照常建出
---
只加兼容测试，不改解析代码。把这两项存成触点结构化字段并在客人页显示，是下一步，开 PR 前先报统筹。
