---
id: 2026-09-27-application-build-required
title: 编译检查设成挡合并的必过项——编译不过的代码，机器自动合和管理员手动合都合不进主干
status: done
owner: pm
decided_on: 2026-09-27
source: session:a853a3c2
verify_by: 2026-09-30
verify_how: 两条都成才算成。①gh api repos/bigbigraydeng-maker/magic-engine/rulesets/20550157：required_status_checks 里有 context 为 Application build、integration_id 为 15368 的一条，原来 6 道都还在，bypass_actors 为 []。②至少一个改规则后新开的 PR，gh pr checks <号> --required 里出现 Application build 且有结论（绿或红都算接上了）
done_on: 2026-09-27
done_ref: pr:2104
last_checked: 2026-10-30
check_note: 10-30：gh api rulesets/20550157 现可读：required_status_checks 共7项(ai-orchestrator-tests、Ledger entries valid、Code change has ledger entry、Ledger refs exist、ops-review-loop-tests、Kernel architecture test、Tour catalog boundary test)，无 Application build；bypass_actors 有1个(卡片要求为空)；PR 3418 --required 亦无该项，与卡片预期不符，交PM确认是否10-18省预算时摘掉
---
起因：9-25 PR #2016 开着自动合并，编译还在跑就被合进主干，35 秒后编译报失败，之后约 7 小时上线全失败。编译检查一直有，只是不在必过名单里。
PM 回「改」授权改规则集；做法：全量读 → 只追加这一条 → 全量写回 → 再读一遍比对，改前备份在会话草稿区。
兜底：两个各自编得过的 PR 叠在一起仍可能编不过，由今日待办「正式网站没换上新代码」提醒兜住（PR 2074）。
