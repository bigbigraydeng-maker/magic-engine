---
id: 2026-11-17-cts-brochure-view-tracking-slice1
title: 在线手册第一刀：客人从目录信点进 CTS 官网后，之后 60 天在这台设备上看了哪个团页面，记进 CRM，客人时间线显示「在官网看了某团」
status: decided
owner: agent
decided_on: 2026-11-17
source: session:96dc6edf
verify_by: 2026-11-21
verify_how: ME 和官网两张改动单都上线后，crm_email_link_clicks 里出现 path 以 /tours/ 开头、counts_as_human=true 的行，对应客人资料页时间线有「在官网看了 <团名>」；同一页面 5 分钟内只一行；没从邮件点进来的访客不产生任何行
---
PM 11-17 回「开始」。方案 docs/specs/2026-11-17-cts-online-brochure-tracking-v0.md 第 9 节第 1 刀：不改页面、不改信、不新开对外接口、不改数据库。
ME：点击接口认官网报来的「页面浏览」（只核浏览器和发信满 1 分钟）；去重从「同一个链接 5 分钟一次」改成「同一个页面 5 分钟一次」；时间线按页面显示团名。官网：第一次从邮件点进来时在这台设备上存两个只属于 ctstours.co.nz 的小记号（60 天），之后只对团页面、团列表、手册上报浏览。
上线顺序：先 ME 后官网。官网隐私说明补一句的措辞待 CTS 确认（方案第 5 节），未改。
