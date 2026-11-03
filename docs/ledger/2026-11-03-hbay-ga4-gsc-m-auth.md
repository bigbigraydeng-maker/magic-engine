---
id: 2026-11-03-hbay-ga4-gsc-m-auth
title: HBay 在 ME 里授权 Google，把访问统计和搜索控制台数据接进 ME（卡在：授权页要的权限比说好的宽，等 PM 点头）
status: decided
owner: pm
decided_on: 2026-11-03
source: session:8044207b
verify_by: 2026-11-06
verify_how: PM 回话同意授权范围后，用 bigbigraydeng 那个 Google 账号走一次设置页的「连接 Google 网站数据」；然后在 ME 里看：Google 那栏显示已连接，GA4 属性选 HBay Water，24 到 48 小时后 GA4 数据不是 0；已知旧坑：GA4 找属性失败时授权会被悄悄丢掉，所以以「有真数据」为准，不看「已连接」。
---
卡点：授权页要的权限含商家资料管理、表格读写、网址索引提交，比「搜索控制台 + GA4」宽，且 Google 提示此应用未经验证。我没点继续。
背景和其余进度见 doc:docs/clients/hbay-water/2026-11-03-hbaywater-website-and-todo.md 「数据测量」一节。
