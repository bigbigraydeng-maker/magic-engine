---
id: 2026-11-28-crm-weekly-report-cts-paused
title: 每周跟进报告先不发给 CTS：收件人改回只有 hello@magicengine.cloud。PM 11-28 晚原话「你先不要发给 cts 了」
status: decided
owner: agent
decided_on: 2026-11-28
source: session:96dc6edf
verify_by: 2026-12-01
verify_how: 12-01 周一上午：①hello@magicengine.cloud 收到当天早上 8 点左右那封主题以 [Beta] 开头、含 follow-up report 的信，收件人一栏只有 hello@magicengine.cloud，没有 ctstours 的地址。②cron_run_logs 里 job_name = crm-followup-weekly-report 最新一行 summary.results[0].recipients 只有 hello@magicengine.cloud。算成：两条都对。不成（收件人里还有 CTS 的地址）时第一步：马上告诉 PM 这一封已经发到 CTS 了，并查这张改动单是不是在 12-01 早上 8 点前合并、部署了。
---
PM 11-28 下午说过「给 CTS 的 info 邮箱也发，标记清楚这是 Beta 功能」（改动单 3976，已上线），当晚看了报告预览后改口「你先不要发给 cts 了」。从 3976 上线到这次改回之间没有到过周一早上 8 点，CTS 一封都没收到。
这次只把 CTS 的地址从收件人名单里拿掉，报告本身、Beta 标记、每周一 8 点的时间都不变，继续发 PM 自己的 hello@。每天早上那封咨询早报（发 CTS info 邮箱，PM 11-25 定的）是另一件事，没有动。
这张改动单必须在 12-01 周一早上 8 点（新西兰时间）之前合并并部署，否则那一期会发到 CTS。再发给 CTS 要 PM 用自己的话说，并改这份名单。
