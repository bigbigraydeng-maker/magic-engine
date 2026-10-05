---
id: 2026-10-05-seo-ctr-diagnosis
title: 每周清单里"点击率低"的页面，开始自带诊断（读这页自己的谷歌搜索词 + 同主题页面 + 标题体检）
status: done
owner: agent
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-06
verify_how: 周一自动运行后（10/5 04:30 UTC），CTS 看板里"加强页面：点击率偏低…"的卡带「系统诊断」一行和这页的搜索词；若写"没取到这页的搜索词数据"，说明线上读谷歌失败，查 cron_run_logs 里 seo-weekly-list 的回执
done_on: 2026-10-05
done_ref: pr:2232
check_note: 线上只演练已当面跑通，见 evidence/2026-10-05-seo-weekly-list-live-dryrun；定时自动运行待首次运行后核对
---
设计：docs/specs/2026-10-04-seo-weekly-list-v0.2.md。只读谷歌搜索数据（免费），不改网站。点击率前后对比在 CTS 流量下判不了，只核对"页面真改了没"和排名。
