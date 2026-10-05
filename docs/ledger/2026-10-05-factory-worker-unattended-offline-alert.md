---
id: 2026-10-05-factory-worker-unattended-offline-alert
title: 出片机做成无人值守：开机自启模板 + 30 分钟离线提醒（代码已写好，还没装、没上线验）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:17ca02a2
verify_by: 2026-10-13
verify_how: PM 同意安装并装好后，看出片机空闲时「出片机存活」那一行每 4 分钟刷新；关掉出片机 30 分钟且队列有活，今日待办出现「出片机离线」，重开后自己消失。
---
代码在分支 feat/factory-worker-unattended，停在 PR Ready，未合并。开机自启模板只写了文件，没有装到本机，装不装要 PM 点头。
存活信号复用已有的运行记录表，没有加表；还没对生产库跑过，要等合并后第一次真实运行才能验。
后续事项（崩溃场景可能重复出片等）写在 PR 正文，没有在这里扩范围。
