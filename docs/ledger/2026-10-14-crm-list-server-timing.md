---
id: 2026-10-14-crm-list-server-timing
title: 名单接口加「各步耗时」（Server-Timing）：每页 50 人实测几乎没变快，先量清楚时间花在哪一步再改
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2620
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 在 PM 的 Chrome 里读名单接口响应的 Server-Timing，能看到 gate / rpc_stages / page_rows / page_ready / touches_briefs / assemble / total 各步毫秒数；响应里没有编号或个人信息
---
PM 2026-10-14 回「加耗时」。只加诊断头，不改任何功能和数据。每页 50 人实测中位数约 1.7 秒、100 人约 1.5 秒，说明大头是固定开销。合并后用真实数字定下一步改哪里。
