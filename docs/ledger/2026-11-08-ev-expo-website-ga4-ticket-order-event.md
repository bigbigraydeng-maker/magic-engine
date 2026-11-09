---
id: 2026-11-08-ev-expo-website-ga4-ticket-order-event
title: EV Expo 广告继续落官网购票页，ME 成绩以 ME 自己 GA4 里的「付款完成」事件为主账本，GA4 直接写进页面，不碰 Squid 的 GA4 和 Tag Manager
status: decided
owner: pm
decided_on: 2026-11-08
source: session:9dbd819a
verify_by: 2026-11-10
verify_how: 抓官网购票页源码能搜到 ME 的 GA4 编号和 ticket_order_complete；Squid 的 Tag Manager 公开文件仍是版本 8 没变；带在投广告原标记打开购票页，ME 的 GA4 实时报表看到这次访问；三条全过算成；第一笔真订单出现在 ME 的 GA4 才算账本跑通
---
2026-11-08 只读核实：所有人都在官网 /register 的 Eventbrite 内嵌购票框付款；官网 GA4（很可能是 Squid 的）不记买票；ME 在投 6 条广告全部落 /register 且带来源标记。
路线由 EV Expo 主窗口定：继续落官网，不改链 Eventbrite；现有来源标记先不动，按 women30 / segments / students / magicengine 四个活动名筛，等改广告时再统一成 me_ 命名。
设计见 doc:docs/clients/ev-tech-expo/2026-11-08-tracking-utm-design-v2.md；把组代号传进购票框（Eventbrite 追踪链接）只是给 Glenn 的可选项。邮件草稿 2026-11-08-ga4-email-draft-design-shore.md 已按此改，ME 的 GA4（G-G6SYRV7QSC）已建好并填进邮件，未发，等 PM 点头。
这本账只记单数，不记票数和金额，免费票订单也算一单。手机实测：加载动画快网络下约 4.6–6.4 秒，买票框在第一屏下面，改不改要客户同意。
