---
id: 2026-09-26-gsc-page-daily-write
title: 谷歌搜索「每一页每一天」的数据开始全部存下来，并自动补齐过去 16 个月（第 4 条 PR-A，只存不读）
status: done
owner: agent
decided_on: 2026-09-26
source: session:3b976bb5
done_on: 2026-09-26
done_ref: pr:2068
verify_by: 2026-10-03
verify_how: 迁移 apply、部署、Inngest 重新 Sync 并跑过第一次派单后查四件事：①gsc_page_fetch_receipts 里 CTS 与 Oztop 都有 status=complete 的日更回执，data_from_day / data_through_day 都有值；②gsc_page_daily 里这两个客户各自的行数都大于 50（以前只存前 50 页）；③补历史回执逐日往更早的月份推进（每客户每天最多 3 个月，failed 的月份第二天会被重派）；④定时任务健康检查里 gsc-page-daily 是绿的（没有逾期、没有卡死、没有「回执表 26 小时没新行」）。四项都对算成；任何一项不对，先看那张回执的 status / failure_kind / error
---
PM 2026-09-26 回「全开工」（第 4 条，A 级：新表 + 迁移）；设计稿 v3 经子牙、魏征设计审。本卡只管 PR-A（写入），PR-B（读方切换）另开卡。
迁移未 apply：apply 前要 PM 在对话里点头；建议先 apply 再部署，部署后去 Inngest 后台重新 Sync。
已当场试跑（本机、替身谷歌接口、按表建模假库）：两天派单、翻页、截断、429、403、写库失败、超长网址、onFailure 收口都走通；真实拉取要等生产授权和迁移上线。
跟设计稿不一样的地方写在 PR 描述里（健康检查看 started_at、每页一步、回执 id = 运行记录 id）。
