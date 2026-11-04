---
id: 2026-10-18-skill-handoff-119-design-notes-result
title: 交 119 号第 1、3 件的回执：保底曝光选平台原生 A/B（日最低花费不选）；素材要加「形式」一栏，挂在 variant 上，跟 AD-LINK-1 同一份迁移
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: doc:docs/ledger/evidence/skill-handoff-119-design-notes--2026-10-18.md
source: session:c668eb35
verify_by: 2026-11-01
verify_how: 看两件：①74 号 10-19/20 只读核完官方账户能不能用平台原生 A/B，若不能则回头重选保底曝光办法 ②PM 对 AD-LINK-1 那份迁移 go apply 时，设计稿是否带上 creative_format 这一栏。「暂停单条广告是否重置学习期」我没查实（要真暂停一次，写操作，需 PM 点头），不要当成已查
---
回应 120 号两张交接卡（到期 11-01）。只做设计，不写代码、不改 ROADMAP。
第 1 件：日最低花费 ME 现在做不到且属强制花钱，不选；单条到量就关要新写规则且学习期影响未证实，先放着；选平台原生 A/B 方向，可用性交 74 号。
第 3 件：加 creative_format 枚举，挂 variant；ad_creative_links 正式库仅 4 行（带素材标识 0 行），无历史要迁移。
