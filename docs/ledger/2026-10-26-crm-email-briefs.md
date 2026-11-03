---
id: 2026-10-26-crm-email-briefs
title: CRM 的 AI 简报接通邮件渠道：先拉邮件全文再清洗掉引用历史，按客户开关、默认关着（CTS 员工说 CRM「不好用」的头号原因是邮件客人全是光秃秃的）
status: decided
owner: pm
decided_on: 2026-10-26
source: session:96dc6edf
verify_by: 2026-11-02
verify_how: 开关默认关，**打开前**先跑只读试跑（脚本做法见 PR 正文「当场试跑」一段）给 PM 看 3 张真实卡；PM 认可后把 CTS 的 clients.leads_config.email_briefs.enabled 设为 true，然后①一小时内看 conversation_briefs 里出现 channel=email 的对话的卡（SQL：按 conversations.channel='email' join 一下，期望从 0 涨起来，每小时最多 25 段）②打开 CTS 任一邮件客人的抽屉，卡里的「下一步」应是具体动作且不说「去 Messenger 找他」③抽查 3 张卡的「我们承诺过」，每条都要能在我们发出的邮件里找到原话④运行记录里 skippedEmpty 不为 0 是正常的（客人只把我们自己的推广邮件转回来、没写字）
---
查实：CTS 邮件 553 段对话、简报 0 张（私信 930 段有 525 张，功能本身是好的）。
拦路石不是那行渠道过滤，是邮件正文在库里只存 255 字摘要，73% 的客人来信被截断；
拉全文又会带回整段引用历史（一封真实来信客人只写 78 字、我们自己的营销文案 3890 字）。
做法：拉全文 → 切掉引用历史/签名/设备页脚 → 转发内容单独加标签 → 提示词认渠道。
已知未解决：建议回复仍会编商业事实（试跑里编了「价格有有效期」）——私信那条路也一样，是提示词的老问题，另开卡修。
