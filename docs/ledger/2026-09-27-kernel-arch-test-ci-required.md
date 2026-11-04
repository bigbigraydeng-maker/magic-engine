---
id: 2026-09-27-kernel-arch-test-ci-required
title: 内核架构检查接进每个 PR 自动跑，并设成挡合并的必过项（红了谁都合不进）
status: done
owner: agent
decided_on: 2026-09-27
source: session:d1add426
verify_by: 2026-09-30
verify_how: 两条都成才算成。①gh api repos/bigbigraydeng-maker/magic-engine/rulesets/20550157（要用有规则集写权限的身份查，否则不返回 bypass_actors）：required_status_checks 里有 context 为 Kernel architecture test、integration_id 为 15368 的一条；原来 5 道 ai-orchestrator-tests、Ledger entries valid、Code change has ledger entry、Ledger refs exist、ops-review-loop-tests 都还在；deletion、non_fast_forward、pull_request 三条规则都还在；bypass_actors 字段存在且为 []（字段缺失不算）。②至少找到一个这个 PR 合并后新开的 PR：gh pr checks <号> --required 里出现 Kernel architecture test 并且有结论（绿或红都算接上了，红说明闸在拦；找到的都一直 Expected 或 pending 才算没接上）
done_on: 2026-09-27
done_ref: pr:2079
last_checked: 2026-10-28
check_note: 夜巡 gh api 规则集20550157：必过项含 Kernel architecture test(integration 15368)及原5道，deletion/non_fast_forward/pull_request 都在，PR3355 上该检查 pass；但 bypass_actors 非空(RepositoryRole 5 always)，不满足 verify_how 要求的 []，且未找到 PR 合并后 Expected 状态对照；规则集后来是否有意放开管理员绕过需 PM 确认，判不了
---
子牙、魏征设计审一致：不进必过清单，这道检查红了也挡不住 B/C 级自动合并，等于摆设。PM 回「合」= 合并 + 设成必过（先合并、再改规则集）。
改规则集按「全量读 → 只追加这一条 → 全量写回 → 再读一遍比对」做，改前改后的证据贴在 PR 里。
这道检查只认一种写法的 import，还有已知盲区，不能说成「对外写已经被机器保证只走内核」；盲区见 PR 的后续事项。
