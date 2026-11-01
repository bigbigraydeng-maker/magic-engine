---
id: 2026-11-02-crm-calendar-mine-only-toggle
title: CRM 日历页加「全公司 / 只看我的」开关：回电按客人的跟进人过滤，默认仍看全公司
status: done
owner: agent
decided_on: 2026-11-02
done_on: 2026-11-02
done_ref: pr:3508
source: session:96dc6edf
verify_by: 2026-11-04
verify_how: 合并部署后用 CTS 员工账号打开 /crm/calendar：顶部出现「全公司 / 只看我的」；默认全公司，回电数量与之前一致；点「只看我的」只剩跟进人是自己的回电；没人跟进的客人只出现在全公司。接口返回含 viewerEmail，每条回电含 assignee。
---
PM 2026-11-02 问 info@ctstours.co.nz 登录有没有专属日历，回「做」。
做法：回电的归属取客人的跟进人（contacts.assigned_to，已有下拉可改），日历接口多返回 assignee 与 viewerEmail，页面按开关过滤；不碰客人归属本身。
注意：目前 1292 位客人里 1237 位的跟进人是 info@，其余同事要等客人分给他们后「只看我的」才有内容。
