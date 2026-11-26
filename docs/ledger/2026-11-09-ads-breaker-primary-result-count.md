---
id: 2026-11-09-ads-breaker-primary-result-count
title: 熔断按客户主结果数，不把开聊当成无线索
status: decided
owner: agent
decided_on: 2026-11-09
source: doc:docs/ledger/2026-11-09-ads-circuit-breaker-propose-pause.md
verify_by: 2026-11-12
verify_how: 主结果是开聊且当天开聊大于 0 时不出没有结果的暂停卡；开聊为 0 且花费超目标倍数才出卡。主结果数读不出时不出卡。留资客户与改前一致。
---
暂停卡的「没有结果」按客户设置的主结果计数。
开聊对上开聊数，留资对上留资数。
主结果数读不出来就不出暂停卡，不当成 0。
留资客户的判定与改前一致。
