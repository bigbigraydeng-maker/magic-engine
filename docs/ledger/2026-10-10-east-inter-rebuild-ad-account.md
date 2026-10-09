---
id: 2026-10-10-east-inter-rebuild-ad-account
title: East Inter 两个旧广告户都废掉，重建一个干净的（PM 2026-10-10 当面拍板「重建」）
status: verified
owner: agent
decided_on: 2026-10-10
source: session:ffe11a13
verify_by: 2026-10-15
verify_how: 查新户三项：国家字段非空、时区是奥克兰、货币是纽币；再看付款方式是否已加上。四项全成才算成。只要国家字段仍是空的，就是又建坏了，必须当场重建而不是将就。
done_on: 2026-10-10
done_ref: doc:docs/ledger/2026-10-10-east-inter-ad-account-country-field-is-effect-not-cause.md
verified_ref: doc:docs/clients/east-inter/2026-10-10-ad-account-payment-readiness.md
last_checked: 2026-10-10
check_note: 作废归档，不是验成功：决定被推翻，不得执行；用 verified 只为不再进每日待办的「重做」
---
【已作废】PM 改选启用澳币户，且本卡根因被推翻（国家字段为空更可能是结果而非原因），不得再按本卡废户重建，废户撤不回。更正见 doc:docs/ledger/2026-10-10-east-inter-ad-account-country-field-is-effect-not-cause.md
原决定（仅留档）：纽币户国家字段为空，加卡被判成「更新国家」而拒绝，故废两个旧户、建一个纽币+奥克兰的新户；两旧户零花费零欠款。
澳币户当时被判时区是苏黎世且改不掉，故不启用；新户按「谁付钱」定口径，投澳洲靠广告组定向。
输卡仍只能 PM 本人做；建号走 skill me-meta-ad-account-setup 路径 B，合同退出条款已具备。
背景见 doc:docs/clients/east-inter/2026-10-10-ad-account-payment-readiness.md
