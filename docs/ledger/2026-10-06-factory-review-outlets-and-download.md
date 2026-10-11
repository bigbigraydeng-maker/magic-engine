---
id: 2026-10-06-factory-review-outlets-and-download
title: 审核卡片显示「通过后会去哪里」各出口真实状态，并加下载成片按钮（不新建任何出口）
status: done
owner: agent
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: pr:2324
source: session:619710c8
verify_by: 2026-10-13
verify_how: PM 在看板打开一条待审片，点开「通过后会去哪里」能看到 Facebook 已接通、Instagram/TikTok/广告/每日计划未接通；点「下载成片」能下载 mp4；全部工单状态里已通过的片也有下载链接
---
出口状态是 2026-10-06 对照代码核实的静态说明，出口接通时要同步改 src/lib/factory/outlets.ts。广告出口另见 R4 任务单，每日计划已暂缓到 10-20 之后。合并后改 done 补 done_ref。
