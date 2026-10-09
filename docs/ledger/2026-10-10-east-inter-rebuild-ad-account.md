---
id: 2026-10-10-east-inter-rebuild-ad-account
title: East Inter 两个旧广告户都废掉，重建一个干净的（PM 2026-10-10 当面拍板「重建」）
status: failed
owner: agent
decided_on: 2026-10-10
source: session:ffe11a13
verify_by: 2026-10-15
verify_how: 查新户三项：国家字段非空、时区是奥克兰、货币是纽币；再看付款方式是否已加上。四项全成才算成。只要国家字段仍是空的，就是又建坏了，必须当场重建而不是将就。
done_on: 2026-10-10
done_ref: doc:docs/ledger/2026-10-10-east-inter-ad-account-country-field-is-effect-not-cause.md
verified_ref: doc:docs/ledger/2026-10-10-east-inter-ad-account-country-field-is-effect-not-cause.md
last_checked: 2026-10-10
check_note: 决定被推翻作废，PM 改选启用澳币户，更正见接替卡
---
【已作废】PM 当日改选启用澳币户，且本卡的根因判断被推翻（国家字段为空更可能是结果而非原因），不得再按本卡废户重建，废户不可撤回。更正见 doc:docs/ledger/2026-10-10-east-inter-ad-account-country-field-is-effect-not-cause.md

以下为原决定（仅留档）：
原因：在用的纽币户「国家/地区」字段是空的，加卡时 Meta 把填这一栏判成「更新国家」，先要求关户重建、再直接拒绝，所以卡永远加不上。
澳币户是 2026-09-21 同一流程跑一半的残骸：国家字段有，但时区被塞成苏黎世且改不掉，启用它等于永远对不上日报表。
两个旧户花费与欠款均为零、无任何广告历史，废掉零损失。新户按「谁付钱」定口径：ME 是新西兰公司用新西兰的卡，故纽币 + 奥克兰 + 国家新西兰；投澳洲靠广告组定向。
输卡仍只能 PM 本人做。建号走 skill me-meta-ad-account-setup 路径 B，合同退出条款已具备。
背景见 doc:docs/clients/east-inter/2026-10-10-ad-account-payment-readiness.md
