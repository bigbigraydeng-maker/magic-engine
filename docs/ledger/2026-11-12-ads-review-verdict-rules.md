---
id: 2026-11-12-ads-review-verdict-rules
title: 预算卡和暂停卡到期后按 CPL 规则自动给有用、没用或看不出，并写入客户经验
status: done
owner: agent
decided_on: 2026-11-12
source: session:9c129e32
verify_by: 2026-11-20
verify_how: 等一张已执行预算或暂停卡过观察窗后跑归因任务，flywheel_actions.payload.reviewCase 为三档结论；client_learned_preferences 有 extracted_from_table=flywheel_actions 的行；内部账号在广告门「今天」可见，客户账号看不到改完后的成绩面板。
done_on: 2026-11-12
done_ref: pr:pending
---

默认值由 Raybot 提出，Ray 在 2026-11-12 08:52 NZDT 同意按默认值开工（预算 7 天、暂停 3 天、±15%、最少 5 个主成效、有目标比目标没目标比改前）；客户可在 leads_config.ads_execution_review 覆盖。只写 client_learned_preferences，不新建表。
