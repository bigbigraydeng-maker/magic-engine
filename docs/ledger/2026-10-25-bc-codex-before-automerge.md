---
id: 2026-10-25-bc-codex-before-automerge
title: B/C 自动合并要等 Codex 审过当前这次提交
status: decided
owner: pm
decided_on: 2026-10-25
source: issue:3087
verify_by: 2026-10-31
verify_how: 合进主干后，抽一个 B 级 PR：没有 Codex 审当前提交时自动合并是关的；审过且没有未解决的 P0/P1 之后才打开；再推一次提交会关掉
---
Ray 2026-10-25 00:36（新西兰时间）要求。B 级和 C 级仍按文件判级，但只有 Codex 审过当前提交、且没有未解决的 P0/P1，才打开自动合并。
新提交让旧审查作废；自动合并若已打开，这次会关掉。A 级两签和草稿跳过都不改。
Codex 的干净审查是 PR 评论里的状态记录，提交号要完整；有意见时另有审查和行内评论。P2 不挡。
闸门脚本仍从主干取出。机器人留言唤不醒 Codex，所以这道闸不代发审查请求。
