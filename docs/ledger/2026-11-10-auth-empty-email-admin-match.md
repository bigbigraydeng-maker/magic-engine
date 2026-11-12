---
id: 2026-11-10-auth-empty-email-admin-match
title: 登录访问判断有个已有的小漏洞：管理员名单末尾多一个逗号时，没有邮箱的登录会被当成全局管理员（先查线上名单写法和是否开了匿名登录，再定怎么修）
status: decided
owner: pm
decided_on: 2026-11-10
source: session:940bdb1b
verify_by: 2026-11-24
verify_how: 查两件事：①线上 ADMIN_EMAILS 配置里有没有多余的空条目（末尾或中间多一个逗号；只看有没有，不看邮箱内容）；②线上登录有没有开匿名或手机号登录（能产生没有邮箱的登录）。任一件「有」就尽快修（解析管理员名单时过滤空条目 + 没有邮箱直接 403）；两件都「没有」可以排期慢修。
---
来源：资料库 PR 3734 的独立复核发现，已对着代码核实：src/lib/auth/whitelist.ts 解析 ADMIN_EMAILS 时不过滤空条目（DEMO_ADMINS 和 CLIENT_VIEWERS 过滤了）。
影响：所有用 requireDashboardClientAccess 的接口；资料库的四个接口已自己多挡一道（要求登录带邮箱），其余接口没动。
没改共享的访问判断：它是 A 级（鉴权），要 PM 点头；这张卡只记发现和查法。
