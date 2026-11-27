---
id: 2026-11-27-me-send-gate-safety-before-switch
title: ME 自己发信开真发开关前的安全项（第 3 单之三）：每天对账、自家闸线自动停发、退信投诉进今日待办、ME 退订同步到 Mailchimp
status: decided
owner: agent
decided_on: 2026-11-27
source: session:96dc6edf
verify_by: 2026-11-30
verify_how: 合并部署后查 cron_run_logs 里 triggered-send-reconcile 每天 07:30 有一条 completed（summary 里 expired/tripped，no_send=true）；今日待办邮件里有「ME 自动发信」那几类（无事时不出）；mailchimp-suppression-sync 运行记录多出 meUnsubscribeOnly 计数
---
PM 11-27 回「排日期，今天冲刺开发」。发信窗口（142/129）已下线，76 号接手为唯一写入者。按设计稿 §17「P2-2c-3」做：每天对账（超 20 小时没结果的信改「结果不明」，不看授权和开关）、§4.3 闸线：按每份授权里你批的那组安全线、只数这份授权生效之后的信（重新授权就重新计数），连续被拒含钥匙出错 → 系统撤销授权；退信或投诉回执到了当场再判一次。账本分页读全（审查 P0）。
今日待办新增结果不明、硬退信、投诉、回执没回来、钥匙出错、系统自动停发六类（只写人数）；Mailchimp 抑制同步加「有 ME 退订」判据（只能按客人现在的主邮箱打标签）。
不发信、不改库结构。上线前生产只读：真发行 0、授权中 0、ME 退订 0，首轮运行不会动任何数据。开真发正式名单前还要补的五件见卡 2026-11-28-me-send-gate-must-before-real-sending。
