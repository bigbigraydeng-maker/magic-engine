---
id: 2026-11-28-crm-weekly-report-to-cts-beta
title: 每周跟进报告加发 CTS 的 info@ctstours.co.nz，主题和正文开头都标明 Beta。PM 11-28 原话「给 CTS 的 info 邮箱也发，标记清楚这是 Beta 功能」
status: decided
owner: agent
decided_on: 2026-11-28
source: session:96dc6edf
verify_by: 2026-12-08
verify_how: 合并上线并在 Inngest 后台重新 Sync 之后的第一个周一上午（12-01 早上 8 点前上线就查 12-01，否则查 12-08）：①hello@magicengine.cloud 收到主题以 [Beta] 开头、含 follow-up report 的信，收件人一栏同时有 hello@magicengine.cloud 和 info@ctstours.co.nz。②cron_run_logs 里 job_name = crm-followup-weekly-report 最新一行 summary.results[0] 的 sent 为 true、recipients 正好是这两个地址、有 provider_message_id。③信的正文最上面有黄色的 Beta 说明。算成：三条都对。不成时第一步：查回执里的 reason；信没到 CTS 就先别让 PM 跟 CTS 说「已经发了」。
---
PM 11-28 看完试跑的报告后说「给 CTS 的 info 邮箱也发，标记清楚这是 Beta 功能」。收件人名单（函数文件里写死的）从只有 hello@ 改成 hello@ 加 info@ctstours.co.nz，没有加别的地址。
Beta 标记两处：主题以 [Beta] 开头；正文最上面一个黄色说明，写明这是 Magic Engine 的新功能、名字和数字只来自系统里记下的记录、员工用自己手机打或在系统外回的信可能漏记、按名单行动前先核对、有问题发 hello@magicengine.cloud。去掉 Beta 标记要 PM 说。
11-28 当场试跑：带 Beta 标记的版本只发到 hello@ 一封（16:33，回执 01a22037-8f98-7a0c-959e-6b8564012055）给 PM 看；没有往 info@ctstours.co.nz 试发，CTS 第一次收到是上线后的周一自动那封。
没做的：没有事先跟 CTS 员工打招呼说会收到这封信（要 PM 自己说一声）；名单没有逐人对邮箱。
