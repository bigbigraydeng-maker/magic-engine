---
id: 2026-10-14-nal-coexistence-phone-features-pm-confirmed-none
title: NAL 并存接入前置问题：PM 口头确认 NAL 手机/电脑没在用问候语、快捷回复、标签、广播列表、Windows 桌面版
status: decided
owner: pm
decided_on: 2026-10-14
source: session:5d7b9a84
verify_by: 2026-10-20
verify_how: "并存接入（设计稿 docs/specs/2026-10-14-whatsapp-embedded-signup-coexistence-v1.md §7）正式做之前，向 NAL 员工本人再确认一次并留书面记录（微信/邮件截图即可）：手机 WhatsApp Business 里没有设置问候语、离开语、快捷回复、标签、广播列表，也没有在用 Windows 桌面版 WhatsApp。有任何一项在用，要先告知影响（并存后这些在该号上失效/不支持）再决定。"
---
10-14 事实：设计稿给 PM 的第一个问题是「NAL 手机上有没有在用问候语、快捷回复、标签、广播列表、Windows 桌面版」，PM 回「都没用」。这是 PM 口头回答，不是 NAL 员工的书面确认；设计稿要求接入前拿到 NAL 书面确认，仍未做。
前置未满足项（并存接入前）：ME 企业认证通过（10-14 已重新提交复审，10-16 复查）→ 应用审核 → PM 本人点「成为技术提供方」（不可逆）→ 只读检查 176 账户（is_on_biz_app、账户类型、WABA 创建来源、已有订阅）→ NAL 书面确认。
