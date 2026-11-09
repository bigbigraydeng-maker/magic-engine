---
id: 2026-10-27-crm-worklist-fresh-backlog
title: 跟进名单分「新来（7 天内）」和「积压」两档，并排除 WhatsApp 平台占位名，提醒只收新来的
status: done
owner: pm
decided_on: 2026-10-27
source: session:aedf9b5a
verify_by: 2026-11-03
done_on: 2026-10-27
done_ref: pr:3286
verify_how: 合并部署后，用已登录的 Chrome 打开 /api/clients/<CTS>/crm/followup-worklist?assignee=<Lisa 的登录邮箱>&tier=fresh：①tierCounts 里 fresh 与 backlog 之和等于不带 tier 时的总人数②tier=fresh 的每条等待小时数都小于 168③名单里不再有「WhatsApp Business」④响应全文搜不到「@」邮箱和 7 位以上连续数字。把新来名单（姓名 + 来源 + 等了多久）给 PM 看；积压那份另交 Lisa 清一次。
---
PM 看了第一版真实名单（Lisa 名下 39 人，38 人已等超 3 天，最久 29 天）后定：每天提醒只收最近 7 天内客人新说话的，积压单独一份，WhatsApp 平台自起的占位名不算客人。
刚好满 7 天算积压（tier 以小于 168 小时为新来）。客户自己的特例（例如另一家公司的号码混进来）不在共享代码里写死，走「不用回：不是客人」手记。
没做：信件格式、收件人、客户开关、干跑发信（刀 2）；对 Lisa 打开（刀 3，A 级、要 PM 批准）。
