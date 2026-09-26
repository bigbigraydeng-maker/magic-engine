---
id: 2026-09-27-kernel-arch-test-ci-required
title: 内核架构检查接进每个 PR 自动跑，并设成挡合并的必过项（红了谁都合不进）
status: done
owner: agent
decided_on: 2026-09-27
source: session:d1add426
verify_by: 2026-09-30
verify_how: ①gh api repos/bigbigraydeng-maker/magic-engine/rulesets/20550157 的必过清单里有 Kernel architecture test，且原来的 5 道必过、防删除、防强推、PR 规则都还在，bypass 仍为空；②这个 PR 合并后新开的任意一个 PR，gh pr checks <号> --required 里出现 Kernel architecture test 且是绿的。两条都成才算成
done_on: 2026-09-27
done_ref: pr:2079
---
子牙、魏征设计审一致：不进必过清单，这道检查红了也挡不住 B/C 级自动合并，等于摆设。PM 回「合」= 合并 + 设成必过（先合并、再改规则集）。
改规则集按「全量读 → 只追加这一条 → 全量写回 → 再读一遍比对」做，改前改后的证据贴在 PR 里。
这道检查只认一种写法的 import，还有已知盲区，不能说成「对外写已经被机器保证只走内核」；盲区见 PR 的后续事项。
