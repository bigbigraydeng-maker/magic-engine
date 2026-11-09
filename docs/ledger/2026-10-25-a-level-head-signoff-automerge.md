---
id: 2026-10-25-a-level-head-signoff-automerge
title: A 级两签齐且检查全绿后自动合，库表和广告花费仍留给 Ray
status: decided
owner: agent
decided_on: 2026-10-25
source: session:a73913dc
verify_by: 2026-11-01
verify_how: 本闸合进主干后，抽一个不碰库表、Meta 凭证和广告花费的 A 级 PR：两签都在当前提交、必过检查全绿、审查对话都解决，自动合并被打开；只缺 Claude 或推了新提交则不开。
---
Ray 2026-10-25 定：A 级也走现有闸自动合，但只认当前这次提交上的 Codex 与 Claude Code 签字。
必过检查要全绿，审查对话要全部解决。新推送让两签都作废。
碰数据库 migration、Meta 凭证，或会改 Meta 广告系列、预算、出价的，标 needs-ray-merge，永不自动合。
原因写在闸门评论里。本改动本身是 A 级，由 Ray 亲手合。
