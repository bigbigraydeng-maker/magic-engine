---
id: 2026-11-10-creative-state-cards
title: 素材放量和退役先记成确认卡，确认前不改广告
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:docs/ledger/evidence/2026-11-03-ads-impact-25-packages-audit.md
verify_by: 2026-11-16
verify_how: 用假端口跑出卡和确认：出卡不调用建广告或暂停；确认放量只建一次暂停广告，回读不符就标失败不再写。
---

出卡只写待确认记录。人点头并且快照和规则仍成立，才走注入的端口建暂停广告、记下新计划，或暂停。同一条没完成的建议不重复出卡。
