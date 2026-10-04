---
id: 2026-10-05-cts-site-gtm-not-installed
title: CTS 官网没有真正装 GTM 主脚本：网站 dataLayer 的成功事件没人接收（联系页、旅游团询盘成功信号到不了 GA4）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-12
verify_how: 查网站代码仓库谁维护；决定"装 GTM 主脚本"或"成功时直接 gtag 发事件（定制页已是这么做）"；改后在 GA4 事件列表看到 contact_form_submit / tour_enquiry_submit
---
证据（2026-10-05 当面查）：线上页面没有 gtm.js 脚本，Tag Assistant 报"GTM-MRW95G5Q 未找到"；GA4 近 28 天 13 种事件里没有 tour_enquiry_submit / contact_form_submit / generate_lead，关键事件为 0。GTM 容器里只有 Google tag 与"GA4 - Generate Lead"（监听名为 form_submit 的信号，网站不发）。
GTM 工作区里已有 3 项未发布草稿（CE - tour_enquiry_submit、GA4 - Tour Enquiry Success、GA4 - Contact Form Success；CE - contact_form_submit 是 PM 先建的），网站装上 GTM 后才会生效，当前不要发布。
网站代码不在 ME 仓库，属客户网站改动，需先确认维护方与发布方式。
