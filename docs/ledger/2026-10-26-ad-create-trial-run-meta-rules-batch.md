---
id: 2026-10-26-ad-create-trial-run-meta-rules-batch
title: 建广告第三次真跑前补齐 Meta 规则四处：日预算组至少跑 2 天、不低于账户最低日预算、留资 CTA 不带自定义网址、养受众不发 ON_VIDEO
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3182
verify_by: 2026-10-29
verify_how: 合并部署后用 CTS 7274 账户重跑试跑（日预算 2、跑 2 天，留资视频）：系列/组/创意/广告四步建成且全暂停；读回创意 object_type 为 VIDEO、call_to_action.value 只有 lead_gen_form_id、没有自定义网址；读回系列 is_adset_budget_sharing_enabled 要单独 GET（entity-settings 字段表不含它）；日预算低于账户最低日预算时应在建之前被拒并给人话。作废旧卡 2026-10-26-ad-lead-form-video-data-and-plans 里「读回 call_to_action.value.link 等于 linkUrl」那条验收（那张卡冻结不能改，以本卡为准）。
---
A 级。改 ad-publisher / ad-draft / draft-and-gate / readback。建出来仍一律暂停。
