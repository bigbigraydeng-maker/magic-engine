---
id: 2026-10-26-merge-gate-only-p0-needs-review
title: 合并规则改成「只有 P0 审」：B/C 级检查全绿就自动合、不等任何人签字，要人看一眼就打 p0 标签；A 级只要 Claude Code 一签（Codex 那一签 10-15 已被停用，等它=永久阻塞全仓库）
status: decided
owner: pm
decided_on: 2026-10-26
source: session:96dc6edf
verify_by: 2026-11-02
verify_how: 合并后开一条普通 B/C 级小 PR（例如只改一份文档），不打任何标签：①`Risk gate` 应变绿，摘要写「不是 P0，机器检查全绿后自动合并」②PR 上应出现 GitHub 的自动合并已启用、并在检查全绿后自己合掉，全程没人签字；再开一条打上 p0 标签的：③`Risk gate` 应是红的，摘要写「标了 p0：Claude Code 还没签过当前这次提交」④加上 Claude Code 对该 head 的签字后转绿。另核对一条碰 supabase/migrations 的 PR 仍被标 needs-ray-merge、永不自动合
---
起因：Ray 10-15 停用了 Codex 的三个审查工作流，而 10-25 定的规则要求「B/C 等 Codex 审过当前提交、A 级 Codex+Claude 两签」——那一签永远不会到，仓库里每条 PR 都停在「等 Codex」上（本窗口 #3151、#3154 都撞上）。一道永远不会放行的闸不是闸，是堵，而且不报错，只是所有活一起卡住。
改动：`merge-decision.mjs` 的 B/C 分支不再读 Codex，改读 PR 的 `p0` 标签；A 级去掉 Codex 那一签；闸门与工作流把标签传进来。
读不到标签按 P0 拦住（失败朝严），但摘要写「读不到 p0 标签」不写「标了 p0」——谎称标了会让人去找一个不存在的标签。
`rayHold`（库表 / Meta 凭证 / 广告花费）仍一票否决、留给 Ray 亲手合，这条没动。
