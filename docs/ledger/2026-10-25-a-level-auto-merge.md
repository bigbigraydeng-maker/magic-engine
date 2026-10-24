---
id: 2026-10-25-a-level-auto-merge
title: A 级在双签且检查全绿时自动合，库表凭证和广告花费仍留给 Ray
status: decided
owner: agent
decided_on: 2026-10-25
source: session:a73913dc
verify_by: 2026-11-01
verify_how: 本修复合进主干后，抽一个不碰库表、凭证、广告花费的 A 级 PR：Codex 审过当前提交且没有未解决的 P0/P1，Claude Code 按 merge-authorization 的格式签过当前 base 和 head，必过检查全绿之后自动合并打开。再抽一个改了 supabase/migrations 的 PR，确认没有自动合并，并带 needs-ray-merge。
---
Ray 2026-10-25 拍板：A 级也可以自动合，条件是 Codex 与 Claude Code 都审过当前提交、没有未解决的 P0/P1，且必过检查已全绿。
库表或 SQL、Meta 的 token 与密钥、以及会改广告系列或预算的路径不自动合，打 needs-ray-merge，留给 Ray。
P2 不挡。每条审查对话仍要人工标成已解决，这条仓库规则不动。
新推送让两份签字都失效。开启前仍再对一次当前提交，并带上 --match-head-commit。
