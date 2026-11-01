---
id: 2026-11-01-me-provider-event-intake-p1-live-check
title: 回调上线后的核验：伪造请求被拒、封数 × 事件数 = 表行数、Replay 不重复、一周内没有失败
status: done
owner: agent
decided_on: 2026-11-01
source: session:33ebcd0b
verify_by: 2026-11-15
verify_how: 前提是上一张卡的四步都做完（没做完就如实写「前提未满足」）。①对生产回调地址发伪造签名请求，必须 401 且库里无新行；②发 N 封内部邮件，Resend 后台显示的事件数 = 表里行数；③在 Resend 后台对一条事件点 Replay，表里仍是一行；④若上线以来任何一次投递曾失败并被重试，记下重试是否被接受（验证时间戳重新签名的假设；没有失败就写「未观察到」）；⑤上线满 7 天：Resend 后台 Failed = 0 且表里有行
done_on: 2026-11-02
done_ref: doc:docs/ledger/evidence/2026-11-01-me-provider-event-intake-p1-live-check--2026-11-02.md
last_checked: 2026-11-02
check_note: ①–④已验成（自动重试子项未观察到）；⑤上线满 7 天再验，日历 11-09
---
本机已用真 Postgres + 真 PostgREST + 真 supabase-js 试跑过（见改动单「当场试跑」）；生产链路要等 PM 放行后才跑得了，所以单开这张核验卡。
核验里要做的「启用回调、点 Replay、向 hello@ 发内部测试信」已在放行时一并请 PM 点头（设计稿 §6-3）。
设计与验证计划：docs/specs/2026-11-01-me-provider-event-intake-p1-design-v0.md §7。
