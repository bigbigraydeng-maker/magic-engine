---
id: 2026-11-02-me-send-gate-p2-1b-shadow-await-pm
title: 第二步第二批（彩排）：每天早上只记「本该给谁发欢迎信」、不发信，代码已写好审过，等你说「合」；合并上线后要验第一次自动运行
status: decided
owner: pm
decided_on: 2026-11-02
source: session:33ebcd0b
verify_by: 2026-11-06
verify_how: 看是否已：①本批改动单已由 PM 回「合」后合并，且 Inngest 里能看到 cloud-triggered-send-welcome-dispatch 与 cloud-triggered-send-welcome-sweep 两个函数；②生产库 cron_run_logs 里 job_name 为 triggered-send-welcome-dispatch 与 triggered-send-welcome-sweep 的记录各至少一条、状态 completed（早上 9:00 新西兰时间的那次，11:00 还有一次补扫）；③生产库 triggered_sends 里新增的行全是 dedupe_scope 为 shadow、provider_impact 为 NONE，没有任何 lifetime 行（=没发过信）；④PM 已同意并写入第一份提案行（CTS 的规则快照）；⑤当天最后一次扫描回执里 deferred 为 0（读不到的线索没有行，对照里看不见）。缺哪件就如实写缺哪件
---
这一批只做「彩排」：每天早上 9:00（新西兰时间，11:00 再补一遍读不到的）给有提案行的客户逐个新线索算一遍「ME 本该不该发欢迎信」，结果冻结进账本；不发任何信、不改联系人、不动 Mailchimp。
设计与次序：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §10（P2-1b，已按 PM「缩小」收窄，收窄清单与偏离处见 §16.5）。
合并后第一件事：PM 同意后写入 CTS 的第一份提案行（写入之前登记表会把这条任务显示为「从未运行」，提示里的「key 没连上」是误导，不是故障）；彩排满 5 个有新线索的日子并对得上（旧批次自己的收件人数也要能和彩排看到的人对上账，对不上的要说清是谁），才轮到下一批（Resend 发信等）。
