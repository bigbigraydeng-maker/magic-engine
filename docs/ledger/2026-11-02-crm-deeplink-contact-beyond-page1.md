---
id: 2026-11-02-crm-deeplink-contact-beyond-page1
title: 从日历点进客人：不在名单第一页时按编号单独读取并打开抽屉，不再先弹「不在这份名单里」
status: decided
owner: agent
decided_on: 2026-11-02
source: session:96dc6edf
verify_by: 2026-11-04
verify_how: 合并部署后在 CTS 日历点一个名字靠后的客人（如 David Holmes）：直接打开该客人的抽屉，页面不出现「不在这份名单里了」提示；故意打开一个不存在的编号链接仍应出现该提示。
---
PM 2026-11-02 发现：日历里点 David Holmes，跳到全部客人页先弹「客户不在这里」。
原因：直达链接只在已装载的第一页里找人，没存名字时直接提示。改为先按编号单独读这一位，读不到才提示。
