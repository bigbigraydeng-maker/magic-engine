---
id: 2026-10-26-ad-lead-form-placements-follow-plan-step
title: 留资广告按计划步骤里写的版位锁版位（现在草稿路径只对养受众类锁版位，留资类是自动版位，Audience Network 没排除）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3184
verify_by: 2026-11-09
verify_how: 2026-10-26 试跑（账本 ff664832）读回：留资广告组 targeting 没有 publisher_platforms，即自动版位；计划步骤 ads-lead-a 写的是 facebook_feed/reels/stories，没被带进去。后续做法：draft 接口接收并校验 placements，留资类按步骤版位写 publisher_platforms，并加回读检查（读回版位与计划一致）；B 级起草，合并时按实际改动判级（ad-publisher 改动会判 A）。到期前确认已做，或确认 PM 接受自动版位。正式 50 美元那条按 PM/74 决定先用自动版位上线。
---
74 于 2026-10-26 拍板：这次不为锁版位再加一刀，不阻塞正式条上线；本卡记后续。
