---
id: 2026-10-05-cts-test-conversion-disclosure
title: 披露：2026-10-05 为验证 GA4 事件，在 CTS 正式网站打开过一次 /thank-you，触发谷歌广告转化与 Meta 线索各 1 次（值 1 新西兰元）
status: done
owner: agent
decided_on: 2026-10-05
done_on: 2026-10-05
done_ref: pr:2246
source: session:cdd5dbf9
verify_by: 2026-10-12
verify_how: 在 Google Ads 和 Meta 后台看 2026-10-05（新西兰时间）的转化 / 线索数：比实际询盘多 1 次属预期；GA4 的 tour_enquiry_success 也多 1 次。统计周报和成本时扣除这 1 次，不需要在广告后台删除
last_checked: 2026-10-13
---
/thank-you 页面一打开就会触发 Google Ads 转化与 Meta Lead（由 fireLeadConversion 触发），不只是 GA4 事件。验证 GA4 新事件时我打开过一次，属测试污染，数量极小。之后的验证一律在本机 staging 模式或只读代码核对，不再打开正式感谢页。
