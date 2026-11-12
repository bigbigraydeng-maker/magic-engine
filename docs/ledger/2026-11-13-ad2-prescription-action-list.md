---
id: 2026-11-13-ad2-prescription-action-list
title: 广告处方正文增加机器可读 action_list（暂停 + 调预算各至多一条）
status: done
owner: agent
decided_on: 2026-11-13
source: session:9c129e32
verify_by: 2026-11-20
verify_how: 保存带 action_list 的处方草稿后读 prescriptions.content，字段通过 zod 校验且超过 1+1 时有 generation_meta.action_list_dropped_reason；发卡逻辑未改。
done_on: 2026-11-13
done_ref: pr:3815
---

Ray 2026-11-13 01:28 NZDT 批准 AD-2（B 级，数据/格式）。动作类型 ads.pause_ad_set / ads.adjust_adset_daily_budget；存 prescriptions.content，无新表。AD-3 再消费发卡。
