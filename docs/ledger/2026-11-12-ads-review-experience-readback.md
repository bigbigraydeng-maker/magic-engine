---
id: 2026-11-12-ads-review-experience-readback
title: 开广告执行处方时读回自动归因经验，提示有用/没用次数并压低没用类型的顺序
status: done
owner: agent
decided_on: 2026-11-12
source: session:9c129e32
verify_by: 2026-11-20
verify_how: 客户有 client_learned_preferences（extracted_from_table=flywheel_actions、source=auto_extracted）后，内部出调日预算或暂停确认卡时 scope 带近窗有用/没用次数；多类型候选处方项时「没用」够阈值的项目排在后面；暂停卡归因窗口跟卡上 observationDays（缺省才 3 天），预算仍 7 天。只读，无 Meta 写、无新表/路由。
done_on: 2026-11-12
done_ref: pr:3809
---

Phase 3 + #3803 暂停窗修补：阈值在 leads_config.ads_execution_review（experience_lookback_days 等）可覆盖，默认与 review-verdict-rules 同文件风格。
