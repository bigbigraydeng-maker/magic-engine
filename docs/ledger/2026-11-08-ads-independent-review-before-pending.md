---
id: 2026-11-08-ads-independent-review-before-pending
title: 广告草稿和暂停建议进待批前可先过独立复核，默认关，复核不能代替人点确认
status: decided
owner: agent
decided_on: 2026-11-08
source: doc:docs/specs/2026-11-06-ads-loop-cangjingge-gap-baseline.md
verify_by: 2026-11-18
verify_how: 抽一个客户把 leads_config.ads_independent_review 设为 true，提交一句含「已帮你暂停」的暂停依据或草稿正文，确认没有进入待批；关掉开关后再提交，应与现在一样能出卡。开关没开的客户行为不变。
---
挂在暂停广告组确认卡和暂停草稿确认卡上，位置在原有硬检查之后、出待批卡之前。依据是现有考卷红线和判分，不新写一套规则。
复核只能通过并在卡上打标记，或退回并写理由；退回不出待批卡。通过之后仍要人点确认。
默认关：leads_config.ads_independent_review 不是 true 就不复核。不改表、不调广告接口。
老的「花钱没结果」暂停建议和建完再送审的草稿不走这两张卡，这次没接。要不要接，等 Ray 定。
开关读不到时这次不拦下、也不当成开了。若读失败必须一律不送审，要另改。
