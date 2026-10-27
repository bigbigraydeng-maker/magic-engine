---
id: 2026-10-28-code-comments-real-customer-name-mailchimp-tags
title: Mailchimp 标签相关代码注释里写着一位真实客人的姓名，需要抹掉（客户私有信息不进共享代码）
status: decided
owner: agent
decided_on: 2026-10-28
source: session:82f88edf
verify_by: 2026-11-11
verify_how: "在 src/lib/mailchimp/tags.ts 和 src/lib/mailchimp/paid-tagging.ts 的注释里搜那位客人的姓名应为 0 处，改成「某位已付款客户」这类描述；同类注释在全仓再扫一遍，不留客人姓名"
---
魏征复审 newsletter agent 手册时顺带发现，我已对着代码核实：两个文件的头部注释都点了同一位已付款客人的真实姓名（9/1 那次群发事故的例子）。
这不属于 newsletter agent 手册的范围，我没改任何代码；需要开发窗口认领，只改注释措辞，不动逻辑。
