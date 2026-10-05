---
id: 2026-10-05-cts-site-gtm-not-installed
title: CTS 官网没有真正装 GTM 主脚本：网站 dataLayer 的成功事件没人接收（联系页、旅游团询盘成功信号到不了 GA4）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-12
verify_how: 查网站代码仓库谁维护；决定"装 GTM 主脚本"或"成功时直接 gtag 发事件（定制页已是这么做）"；改后在 GA4 事件列表看到 contact_form_submit / tour_enquiry_submit
last_checked: 2026-10-05
check_note: chinatravel#220 草稿待 PM 合并；合并上线后用 GA4 实时报告核对 generate_lead
---
证据（2026-10-05 当面查）：线上页面没有 gtm.js 脚本，Tag Assistant 报"GTM-MRW95G5Q 未找到"；GA4 近 28 天 13 种事件里没有 tour_enquiry_submit / contact_form_submit / generate_lead，关键事件为 0。GTM 容器里只有 Google tag 与"GA4 - Generate Lead"（监听名为 form_submit 的信号，网站不发）。
GTM 工作区里已有 3 项未发布草稿（CE - tour_enquiry_submit、GA4 - Tour Enquiry Success、GA4 - Contact Form Success；CE - contact_form_submit 是 PM 先建的），网站装上 GTM 后才会生效，当前不要发布。
网站代码不在 ME 仓库，属客户网站改动，需先确认维护方与发布方式。

2026-10-05 跟进：不装 GTM，改在网站统一的"线索转化"函数里补发 GA4 `generate_lead`（联系页 / 旅游团询盘 / 列表页 / 定制页一次覆盖，不带金额）。网站仓库 chinatravel 草稿 PR #220（https://github.com/bigbigraydeng-maker/chinatravel/pull/220），单测 83 条全过，本机 staging 模式当场看到 conversion → generate_lead；合并会部署 CTS 正式网站，等 PM 回"合"。
披露：2026-10-05 为验证 GA4 事件，在正式网站打开过一次 /thank-you，该页会同时触发谷歌广告转化与 Meta Lead 各 1 次（值 1 新西兰元），属测试污染，数量极小，已告知 PM。
