---
id: 2026-10-26-ad-lead-form-video-data-and-plans
title: 留资视频广告创意改成实测过审的 video_data 写法（带封面），并出刀①刀②方案稿（未动手）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3177
verify_by: 2026-10-30
verify_how: 合并后用 ME 的 draft 接口建 $1 试跑（CTS 7274 账户），回读 creative 应是 object_type VIDEO，publisherPlatforms 不含 Audience Network；读回 call_to_action.value.link 应等于草稿的 linkUrl；PM 在审批页点过一次后立即暂停并删除。
---
A 级代码（ad-publisher / ad-draft 小改动 + 测试，建出来仍一律暂停）。r2 视频已传到 CTS 的试跑广告账户（账户号和视频号见 PR 3177 正文）。刀①刀②方案见 docs/specs/2026-10-26-ad-plan-step-one-click-draft-and-audience-v0.1.md，等 74 回复。
