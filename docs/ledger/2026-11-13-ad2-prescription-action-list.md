---
id: 2026-11-13-ad2-prescription-action-list
title: 广告处方正文增加机器可读 action_list（暂停 + 调预算各至多一条）
status: done
owner: agent
decided_on: 2026-11-13
source: session:9c129e32
verify_by: 2026-11-20
verify_how: 华佗生成或精修后读 prescriptions.content.action_list 与 generation_meta.action_list_dropped_reason（超 1+1 时与 manual 同键）；HUATUO_GENERATION_SYSTEM_PROMPT 含 action_list schema；预算不进顶层 legacy 块；发卡未改。
done_on: 2026-11-13
done_ref: pr:3815
---

Ray 2026-11-13 01:28 NZDT 批准 AD-2（B 级，数据/格式）。动作类型 ads.pause_ad_set / ads.adjust_adset_daily_budget；存 prescriptions.content，无新表。AD-3 再消费发卡。
Ray 2026-11-13 01:59 NZDT（PR #3815）：v1 华佗 prompt 须输出 action_list（仍不发卡）；华佗 generate/refine 裁剪留痕写 generation_meta.action_list_dropped_reason；预算仅 action_list、不镜像顶层预算块；预算行 direction/expected_metric 保持可选。
P1：暂停行不再写入 content.pause_ad_set。保存后仍是 action_list 的 ads.pause_ad_set，订单形状与 AD-3 issueOnePauseCard 相同，本 PR 不出卡。
