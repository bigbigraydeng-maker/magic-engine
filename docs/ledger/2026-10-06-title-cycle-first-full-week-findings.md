---
id: 2026-10-06-title-cycle-first-full-week-findings
title: 自动改标题第一整周：9 个候选只过闸 1 个、最终自动改 0 个——不是坏了，是可改范围窄；三道安全闸在真实运行里都拦住了东西
status: done
owner: agent
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: doc:docs/ledger/evidence/2026-10-06-title-cycle-first-full-week.md
source: session:cdd5dbf9
verify_by: 2026-10-13
verify_how: 10/12（周一）下一轮自动改标题跑完后看 step3/step4 回执：①自动合并数（0 以上才会让清单里的任务自动记"已执行"）；②若连续两周仍是 0，再评估是否把 guides.ts 里的目的地指南纳入可编辑范围（要改 cts-meta-pr.ts 文件名过滤和 metaTitle / metaDescription 的替换写法，属 A 级，且潜力约 100 次点击/28 天，不大）
last_checked: 2026-10-13
---
证据与 8 个被挡候选的逐条原因见证据文件。三道闸（不借别页查询词、关键词 90 天不重复、事实核对）均在真实运行中拦住了东西，其中事实核对拦下了一条与原文事实矛盾的新描述。
对"闭环"的含义：清单的"已执行"自动记录要等周循环真正改出东西才会触发；本周为 0，所以第一次真闭环最早是 10/12 那轮改动、10/19 清单再跑时。
