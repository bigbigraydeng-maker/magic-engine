---
id: 2026-09-27-messenger-sync-completed-while-five-clients-fail
title: 每小时私信同步 5 个客户失败、任务状态照写 completed——监控看着一切正常
status: decided
owner: pm
decided_on: 2026-09-27
source: session:5b9407a2
verify_by: 2026-10-06
verify_how: `select status, failed_count from cron_run_logs where job_name='messenger-sync-hourly' order by started_at desc limit 5` —— 只要 `failed_count > 0` 而 `status='completed'` 还同时出现，这个盲区就还在；修好之后应该是「部分失败」这类能被告警认出来的状态
---
小秘书 2026-09-27 要求把这条从 CRM 接入那轮里拆出来单独立卡。

## 现象

`messenger-sync-hourly` 每小时跑，2026-09-27 06:10 那次：7 个客户里 **5 个报错**，任务状态写的是 **`completed`**。

同一时段 `meta-leads-sync` 写的是 `failed`（因为 Magic Lab Class 抛了 Meta 400）。**两条任务对「算不算失败」的口径不一样。**

## 为什么危险

这正是 [[feedback-monitoring-writer-silent-failure-inverts-health-check]] 那个形状：**「不在告警范围」和「一切正常」在监控里长得一模一样。** NAL 的私信断了 11 天，期间每小时都有一条运行记录写着 `completed`。

发现没有死在日志里（`page-binding-items` 和 `facebook-sync-items` 两张卡都在下发），所以这不是断头管道。但**健康状态是错的**：任何看运行记录判断「私信同步好不好使」的人（包括以后的 agent）都会得出相反的结论。

## 不在这一轮做

跟 CRM 接入不是一件事，也不该混进那个 PR。这里只登记事实和判据。

## 修的时候要注意的一件事

不能简单改成「有一个客户失败就整次 failed」—— 那样 Magic Lab Class 这种「客户自己撤了权限、我们修不了」的长期状态会把这条任务永久钉成红色，告警很快就会被忽略。要分开「这次跑动本身成没成」和「有几个客户处于已知待人工处理状态」。
