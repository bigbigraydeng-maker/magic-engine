---
id: 2026-11-03-hbay-ga4-gsc-setup
title: HBay 官网接上 Google 访问统计（GA4）并通过搜索控制台域名验证；品牌站不设关键动作，主数字看品牌词搜索量和 AI 可见度
status: done
owner: agent
decided_on: 2026-11-03
source: session:8044207b
verify_by: 2026-11-05
verify_how: 只读查三件：①hbaywater.com 首页源码含 G-ZL3CZPGQ35；②Google Analytics 里 HBay Water 属性有真实访客数据（数字小正常）；③ME 里 HBay 的 GA4 快照用户数大于 0（授权已于 11-03 完成，见 2026-11-03-hbay-ga4-gsc-m-auth）。三条都对算成。
done_on: 2026-11-03
done_ref: doc:docs/clients/hbay-water/2026-11-03-hbaywater-website-and-todo.md
---
GA4 建在 Magic Engine 账号下，搜索控制台用 Cloudflare 里一条 TXT 记录验证（那条别删）。
sitemap.xml 已加但未提交给 Google，因为网站仍是 noindex，开放收录要 PM 本人点头。
详情见 done_ref 文档「数据测量」一节。
