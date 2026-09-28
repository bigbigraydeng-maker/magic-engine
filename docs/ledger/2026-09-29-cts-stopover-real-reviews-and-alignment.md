---
id: 2026-09-29-cts-stopover-real-reviews-and-alignment
title: CTS官网China Stopover行程卡片——布局对齐修好，14个团全部换成真实Google评价（含删掉2个团原有编造的星级/评论数）；待复核合并
status: decided
owner: agent
decided_on: 2026-09-29
source: session:6a554a1d
verify_by: 2026-10-03
verify_how: 抓 https://www.ctstours.co.nz/tours/china/stopover 的 HTML，三项全部满足才算成：①列表页网格对齐——同行卡片高度/留白一致，不再有参差留白；②14 个团逐个核对，每个团卡片上都出现 "Google review" 来源标注（不是部分团），且不再出现旧的编造摘录文案 "Efficient Beijing transit experience" 或 "Perfect Beijing stopover"；③星级、评论数、摘录文本可溯源到真实 Google 评价（公司整体评分 + 具体某条评价原话），不是新的占位编造数字。任一项不满足＝没生效或没合并。
---
CTS 网站仓 chinatravel（不是 magic-engine）。PM 报卡片留白不均，查出根因是列表页网格的对齐设置，已修。排查中发现 2 个团（Beijing、Beijing Express）原有的星级/评论数/摘录是硬编码假数字，系统从无按团拆分评价的能力；PM 确认后删掉假数字，14 个团统一改用真实的公司整体 Google 评分（每周自动更新）+ 真实客户原话摘录（可溯源到具体哪条评价），不再有编造内容。PR 现为 chinatravel 仓的草稿 chinatravel#215，已发复核请求给子牙（架构+挑刺+客户视角三方过一遍才合并），未合并前真站不会变。

本卡先停在 `decided`，不填 `done_on`/`done_ref`：`done_ref: pr:215` 会被 `scripts/ledger-check-refs.sh` 按本仓（magic-engine）的 `GITHUB_REPOSITORY` 去查，查到的是 magic-engine 自己的 PR #215，跟这条真正的改动（chinatravel 仓的草稿 PR）完全无关，会把外仓未合并的改动误判为可信凭据。合并后再补一张 `done` 更新：`done_ref` 用本仓能无歧义核验的凭据（例如指向一份记录了 chinatravel 合并 commit / PR 链接与核验截图的 `doc:docs/...` 证据文件），不要直接填外仓的 `pr:<n>`。
