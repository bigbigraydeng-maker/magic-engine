---
id: 2026-09-26-merge-gate-repo-settings-wired
title: 合并闸接线完成：Protect main 加 ops-review-loop-tests；新建 Risk gate 独立规则集（admin 可 bypass）
status: done
owner: agent
decided_on: 2026-09-26
source: session:777d6ed4
verify_by: 2026-10-03
verify_how: ①下一个 C 级 PR 走 pr-risk-gate 判 C 后 gh 开 auto-merge，且 GitHub 在必过 5 道全绿后自动合入 main（无人点击）；②下一个 A 级 PR 的 Risk gate 检查因 ME_SIGNOFF_TRUSTED_LOGINS 空而恒红，合并按钮按不动（PM 需用 gh pr merge --admin 才能合，且 Protect main 五道仍全绿）
done_on: 2026-09-26
done_ref: pr:2023
last_checked: 2026-10-11
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 2026-09-26 拍板方案 X 后执行。Protect main 只加 `ops-review-loop-tests`（bypass_actors 保持空、谁都绕不过五道台账/测试检查）；新建独立规则集 `Risk gate`（id 23998653，bypass_actors = RepositoryRole 5 Admin，只含 `Risk gate` 一道），实现"Protect main 五道任何人都绕不过 + Risk gate 一道 PM 用 --admin 能绕"。变量 `ME_SIGNOFF_TRUSTED_LOGINS` 不设 = 谁都不信 = A 级 Risk gate 恒红，等 B3 独立签字身份建成再指过去。旧环境 `merge-authorization` 保留（可选删这次不动）。改前/改后证据存于 scratchpad settings-change/before.txt 与 after.txt。
