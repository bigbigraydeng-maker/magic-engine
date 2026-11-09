---
id: 2026-10-16-meta-leads-sync-per-client-receipts
title: 抓 FB 表单线索的每小时任务改成按客户各记各的回执：授权过期和主页未核实的客户标「被挡住」，不再把整轮跑染红、也不再连累 CTS
status: decided
owner: pm
decided_on: 2026-10-16
source: session:96dc6edf
verify_by: 2026-10-19
verify_how: 合并部署后看最近一次 meta-leads-sync 运行记录：summary 里有 receipts（每客户 ok/blocked/failed）；CTS 为 ok，Magic Lab Class 与 NAL/NZCPE 为 blocked，整轮状态为 completed 而不是 failed；它们各自的待办仍在今日待办里
---
只改回执和告警口径，抓线索本身没动。授权过期、主页未核实各有自己的待办盯着，修它们不在本卡。
注意：授权过期的客户头约 3 小时日报不再提示，之后由「Facebook 同步失败」待办接上。
