---
id: 2026-09-29-cts-stopover-real-reviews-and-alignment
title: CTS官网China Stopover行程卡片——布局对齐修好，14个团全部换成真实Google评价（含删掉2个团原有编造的星级/评论数）；待复核合并
status: done
owner: agent
decided_on: 2026-09-29
source: session:6a554a1d
verify_by: 2026-10-03
verify_how: 抓 https://www.ctstours.co.nz/tours/china/stopover 的 HTML，确认出现 "Google review" 字样且不再出现旧的编造摘录文案 "Efficient Beijing transit experience" 或 "Perfect Beijing stopover"；出现=成，仍出现旧文案=没生效或没合并
done_on: 2026-09-29
done_ref: pr:215
---
CTS 网站仓 chinatravel（不是 magic-engine）。PM 报卡片留白不均，查出根因是列表页网格的对齐设置，已修。排查中发现 2 个团（Beijing、Beijing Express）原有的星级/评论数/摘录是硬编码假数字，系统从无按团拆分评价的能力；PM 确认后删掉假数字，14 个团统一改用真实的公司整体 Google 评分（每周自动更新）+ 真实客户原话摘录（可溯源到具体哪条评价），不再有编造内容。PR 现为草稿，已发复核请求给子牙（架构+挑刺+客户视角三方过一遍才合并），未合并前真站不会变。
