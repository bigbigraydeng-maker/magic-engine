---
id: 2026-10-04-cts-meta-cycle-protected-slugs
title: CTS 的 7 个商业页/签证页列入「自动改标题保护名单」，周一起机器不碰
status: done
owner: pm
decided_on: 2026-10-04
done_on: 2026-10-04
done_ref: doc:docs/ledger/evidence/2026-10-04-cts-meta-cycle-protected-slugs--write.md
source: session:06ec010d
verify_by: 2026-10-06
verify_how: "10/5 UTC 05:30 那一轮之后：①cron_run_logs 里 job_name=seo-meta-cycle-step3-prescribed 当周回执的 failures 中，凡是这 7 个 slug 的都应是 protected_conversion_page（或更早的闸）；②seo_meta_log 里 10/5 新增的行没有这 7 个 slug 中的任何一个。两项都满足算成。"
last_checked: 2026-10-13
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 回「保护」后写入 CTS 的 seo_config.meta_cycle_protected_slugs（7 个页）。写入前后字段、生效证据、一句话回滚 SQL 都在 evidence 文件里。
原因：保护名单代码早就有，但 CTS 这边一直是空的，询盘主入口页只靠别的闸挡着。
