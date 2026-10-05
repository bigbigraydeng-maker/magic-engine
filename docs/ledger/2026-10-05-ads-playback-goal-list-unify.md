---
id: 2026-10-05-ads-playback-goal-list-unify
title: 看完类广告目标的名单有两份对不上（D9 写单数、新闸门写复数），要合成一份
status: decided
owner: agent
decided_on: 2026-10-05
source: session:10bbca62
verify_by: 2026-10-13
verify_how: D9 诊断与回读闸门共用同一份目标名单，并评估是否纳入 TWO_SECOND_CONTINUOUS_VIDEO_VIEWS
---
D9 诊断用 VIDEO_VIEW，闸门用 VIDEO_VIEWS，两边都没覆盖 2 秒连播；回读读不到优化目标时规则会静默跳过。
