---
id: 2026-10-05-ga4-tour-enquiry-success-event
title: CTS 的 GA4 新建"询盘成功"事件 tour_enquiry_success（到过 /thank-you 就记一次，标为关键事件）
status: done
owner: agent
decided_on: 2026-10-05
done_on: 2026-10-05
done_ref: doc:docs/ledger/evidence/2026-10-05-ga4-tour-enquiry-success-event.md
source: session:cdd5dbf9
verify_by: 2026-10-12
verify_how: GA4 近 7 天 tour_enquiry_success 有数；和 CTS info@ 同周 Tour enquiry 邮件封数大致对得上（10/5 验证时自己访问过一次，需扣 1）；再跑 job=ga4-form-funnel 对照旅游团详情页开始填表人数
last_checked: 2026-10-13
---
PM 2026-10-05 当面批准创建。事件规则：page_view 且 page_location 含 /thank-you；关键事件；不设默认价值（默认会塞 1 美元，是编造的数）；每次访问只算一次。当场验证：GA4 实时报告出现 tour_enquiry_success=1 并列入关键事件。
不改网站。联系页（/contact）与定制页成功后不跳感谢页，这条测不到它们；定制页另有 tailor_made_enquiry_submitted。
