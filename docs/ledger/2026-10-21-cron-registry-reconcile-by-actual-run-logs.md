---
id: 2026-10-21-cron-registry-reconcile-by-actual-run-logs
title: 自动任务登记表只认 render.yaml，天生看不见 yaml 之外的调度器：要加一条「按运行记录里实际出现的任务名对账」，标了暂停或退役、近几天却还有运行记录的报红（先出设计，A 级，P3）
status: decided
owner: agent
decided_on: 2026-10-21
source: session:1f83deb6
verify_by: 2026-11-18
verify_how: docs/specs 下有一份这条对账的设计稿，子牙和魏征审过；或 PM 明确说搁置。设计稿要回答：对账数据从 cron_run_logs 哪几列取、「近 N 天」的 N 怎么定、哪些任务名豁免（按需触发的 Inngest 函数没有固定周期）、报红进今日待办的哪一栏。到期没动就顺延，不算失败。
---
子牙审 PR 3000 时提出（统管 18 号转述）：登记表的对账测试只以 render.yaml 为输入，Render 上 render.yaml 之外的服务它天生看不见。2026-10-21 查出 9 个这样的任务（见台账卡 2026-10-21-render-orphan-cron-services-9），对账测试全绿也漏了。
做法（待设计）：另加一路对账，从 cron_run_logs 读近 N 天实际出现过的 job_name，跟登记表和白名单比；标了暂停或退役、近 N 天却还有运行记录的，报红。
统管定 P3，不抢别的活；动登记表与健康检查属 A 级，先出设计稿、审过再动手。
