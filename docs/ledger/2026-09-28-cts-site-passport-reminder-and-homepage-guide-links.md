---
id: 2026-09-28-cts-site-passport-reminder-and-homepage-guide-links
title: CTS 官网两处改动上线——填表页加护照有效期提醒（免签口径+链到签证指南）、首页 6 张城市卡片改指向详尽指南页；待确认真站生效
status: verified
owner: agent
decided_on: 2026-09-28
source: session:b408a472
verify_by: 2026-09-29
verify_how: 抓 https://www.ctstours.co.nz/traveller-details 的 HTML 含 "check your passport before you travel" 且 "own responsibility"（=#209 免签版）；抓首页 https://www.ctstours.co.nz/ 含 "zhangjiajie-travel-guide"（=城市卡片已指向指南页）。两处都出现算成。构建慢（>20min），当天没出现先看 Render 部署日志再判失败
done_on: 2026-09-28
done_ref: pr:210
last_checked: 2026-10-15
check_note: 真站两页 HTML 都含目标文字（护照提醒各 1 处，首页指南链接 6 处）
verified_ref: doc:docs/ledger/evidence/2026-09-28-cts-site-passport-reminder-and-homepage-guide-links--2026-10-15.md
---
CTS 网站仓 chinatravel。护照提醒 = PR #208 首版 + #209 改成「免签、护照有效期是旅客自己责任、建议 6 个月+空白页」并链到既有页 /china-visa-guide-for-new-zealanders（未新建重复页）。首页城市卡片 = PR #210 把 /{city}-tours 改为 /{city}-travel-guide（GSC 证据：指南页曝光是 tours 页 6–23 倍、排名多数更靠前）。三条已合并 main，Render 自动部署；合并当时真站尚未刷新，监控中。
