---
id: 2026-09-22-kernel-claim-rpc-ambiguous-column-fix
title: 执行内核"接任务去执行"这个公共功能有代码 bug，已修好合并；生产库目前没有实际中招
status: verified
owner: pm
decided_on: 2026-09-22
source: session:3799d401
verify_by: 2026-09-29
verify_how: 确认这条修复是否已经真正应用到生产数据库（不只是代码合并），并核对生产库里那个函数当前的写法是否已经跟这份修复一致
done_on: 2026-09-22
done_ref: pr:1905
last_checked: 2026-10-14
check_note: 生产库两个函数的定义今晚实取：kernel_claim_or_takeover_run 含 v_run.reclaim_count 的限定写法、kernel_claim_run_step 含 v_step.attempt 的限定写法，裸写歧义的 bug 形态都已搜不到；仓库确认只有执行内核那份原始 migration 和这份修复定义过它们，没有第三份覆盖。顺手发现 migration 登记表里查不到这份修复的登记行（函数体已是修复后写法，但变更没留痕），超出本卡判据，另开卡跟
verified_ref: doc:docs/ledger/evidence/2026-09-22-kernel-claim-rpc-ambiguous-column-fix--2026-10-14.md
---
给广告自动暂停功能做真实环境验证时，意外发现系统里"接下一个任务去执行"这个公共核心功能，
写法上有一处变量名撞车，导致每次被调用都会报错拒绝执行——理论上会影响所有用到这个执行框架
的功能，不只是广告这一个。已拆成独立任务修好并合并（#1905）。当天直接查了一遍生产数据库：
历史上仅有的两次真实调用都成功完成，没有中招；但这条修复有没有正式对生产数据库生效、
生产那边的函数内容是否已经完全一致，仍需专门确认，且这一步要 PM 点头才能做。
