---
id: 2026-09-26-seo-patrol-card-dedupe-first-run
title: 巡查卡收敛（第 3 条 3a）上线后第一次自动运行当天核对：没有读卡失败、有开着卡的页面没被重开、没超每周名额、没有卡被别的页面顶掉
status: verified
owner: agent
decided_on: 2026-09-26
source: pr:2062
done_on: 2026-09-26
done_ref: pr:2062
verify_by: 2026-09-27
verify_how: 合并部署后第一次 seo-patrol-daily（每天 04:00 UTC，新西兰 17:00）跑完，查：①cron_run_logs 里 job_name=seo-patrol-daily 最近一条 status=completed、failed_count=0（读卡失败会让那个客户记成失败）；②execution_items 里这次运行新开的巡查卡（dimension='seo'、source='zhuge'、steps_json 带 rule_id、created_at 在这次运行开始之后）：CTS 的 china-tours-from-australia 没有新卡，Oztop 没有新卡（本周名额 10/3 前用完），每个客户新开卡的不同目标数加上过去 7 天已开的不同目标数不超过 3；③这次运行里被标成 superseded 的巡查卡，都是建了 14 天以上的（每日清理），没有建了不到 14 天就被顶掉的。三项全对算成；另记一句 CTS 的 Christchurch 那页当天是否开出了第一张卡（前提是当天还有这条发现）
last_checked: 2026-09-28
check_note: CTS新1张卡(Christchurch页)Oztop0张，superseded卡精确14天，三项判据全满足
verified_ref: doc:docs/ledger/evidence/2026-09-26-seo-patrol-card-dedupe-first-run--2026-09-28.md
---
PM 2026-09-26 定的硬规矩：以后才自动跑的功能，交付前要当场试跑，跑不全的部分开卡、验收日 = 第一次自动运行当天。
本卡对应 PR #2062 的「当场试跑」段：已用生产只读快照（CTS、Oztop 当天的 151 条发现和 131 张卡）在本机把新规则跑了一遍；三条新的读卡查询也用公开钥匙在生产接口上实测过写法（都返回 200，两个写错列名的对照返回 400）。
当场跑不了的：真正的巡查定时任务要读十几张表并往看板写卡，只有合并部署后的第一次自动运行才会发生。若合并晚于 9/27 04:00 UTC，按下一次运行核对。
