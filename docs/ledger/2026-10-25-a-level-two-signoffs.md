---
id: 2026-10-25-a-level-two-signoffs
title: A 级合并改为 Codex Astra 与 Claude Code 两签；子牙魏征狄仁杰只抽查 B 级且不挡合并
status: decided
owner: pm
decided_on: 2026-10-25
source: issue:3087
verify_by: 2026-10-31
verify_how: 本规则合进主干后，抽一个 A 级 PR 看 Risk gate 摘要缺的是 codex-astra 和 claude-code；再抽一个 B 级 PR，缺子牙魏征狄仁杰不挡自动合并
---
Ray 2026-10-25 00:10（新西兰时间）口授。闸门脚本仍从主干取出，这条 PR 改不了判自己的尺子，所以它仍按旧的三人签字被判。
仓库变量 ME_SIGNOFF_TRUSTED_LOGINS 本次不改。要让两签能被认出，Ray 需把它设成角色等于登录名，两个登录名还得不同。
建议值写在 .github/merge-authorization.md。自动写入签字标记的路径仍未建成，设了变量也不会自己变绿。
B 级和 C 级仍是必过检查全绿就自动合。抽查缺席不挡。
