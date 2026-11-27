---
id: 2026-11-27-crm-ai-followup-clicked-back-to-staff
title: 「AI 跟进中」的客人点开了我们发的目录、之后没人聊上，就回到员工「今天要联系」（点了邮件里的链接）
status: decided
owner: agent
decided_on: 2026-11-27
source: session:96dc6edf
verify_by: 2026-11-28
verify_how: 上线后 11-28 早上看 CTS「今天要联系」：Amos Pohl、Roya Shervinfar、Sarah Leong 等 8 位在「点了邮件里的链接」那一组，旁边仍有「AI 跟进中」；员工真聊上的人次日早上被停线检查撤掉 AI 跟进
---
PM 11-27 对规矩核查后回「开始」第一件。查出原因：我们自己发信（info@）里的链接被点，从来不算「点了邮件里的链接」，只认 Mailchimp 的点击；AI 跟进中的人又一律藏到「先放着」。
改法：60 天内真人点击记成 lastClickAt 并入点击判断；AI 跟进中的人只要分到「点了链接 / 正在看手册」或点击后打了没接，就留在今天名单，AI 跟进标记不撤。
上线前用生产数据只读估算：60 天内点过链接、之后没人联系的 8 位，全是 AI 跟进中的人。不发信、不改库。
