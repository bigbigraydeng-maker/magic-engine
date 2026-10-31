---
id: 2026-10-28-crm-first-email-ai-draft
title: CRM「写第一封邮件」加「让 AI 帮我写」：员工没时间从空白写，AI 起草、员工看过再发
status: decided
owner: pm
decided_on: 2026-10-28
source: session:96dc6edf
verify_by: 2026-11-05
verify_how: 开关打开后，在 CTS 一位咨询过的客人抽屉点「让 AI 帮我写」：主题和正文应填进框里、金额是纽币、没有编造的价格日期，且页面提示「AI 起草，请核对」；点发送前信不会发出。核对邮件开关 leads_config.email_compose.enabled 是否已由 PM 同意后打开
---
AI 只起草不发送：新接口读客人的表单/对话 + 公司资料 + 币种规则，返回主题和正文，发送仍走原来的员工点发送，配额、只发给咨询过的人、别再联系这些闸不变。
开关 leads_config.email_compose.enabled 仍关着；打开前要先给 PM 自己邮箱试发一封，确认发出去的信在系统里不会变成两条记录。
当场试跑：开关没开时接口按设计拒绝起草，所以真 AI 调用要等开关打开后才能试；本机只跑了带假 AI 的测试。
