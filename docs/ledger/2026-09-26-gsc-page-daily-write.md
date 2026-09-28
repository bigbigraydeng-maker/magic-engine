---
id: 2026-09-26-gsc-page-daily-write
title: 谷歌搜索「每一页每一天」的数据开始全部存下来，并自动补齐过去 16 个月（第 4 条 PR-A，只存不读）
status: verified
owner: agent
decided_on: 2026-09-26
source: session:3b976bb5
done_on: 2026-09-26
done_ref: pr:2068
verify_by: 2026-09-27
verify_how: 迁移 apply、部署、Inngest 重新 Sync 后，第一次 18:30 UTC 自动运行完当天查五件事：①gsc_page_fetch_receipts 里 CTS 与 Oztop 都有 status=complete 的日更回执，data_from_day / data_through_day 都有值，没有停在 running 的；②CTS 某个已定稿日：gsc_page_daily 逐页 clicks 加总 ≈ 同日谷歌全站 clicks（差距在谷歌隐私过滤范围内），逐页 impressions 加总 ≥ 全站 impressions（同一次搜索出现两个页面算两次）——这一条才证明数据是全的；③两个客户各自的行数都大于 50（以前只存前 50 页），只作辅助，不能单独算成；④cron_run_logs 里派单（gsc-page-daily）和执行单（gsc-page-daily-pull）都有记录、没有卡在 running，派单行 summary 带 stopped_backfill_months；⑤定时任务健康检查里这两个任务都是绿的（没有逾期、没有「回执表 26 小时没新行」）。都对算成；不对先看那张回执的 status / failure_kind / error
last_checked: 2026-09-28
check_note: 收据全complete，CTS 9-24页级数据与卡上探测数字完全一致，全库30855行覆盖4客户
verified_ref: doc:docs/ledger/evidence/2026-09-26-gsc-page-daily-write--2026-09-28.md
---
PM 2026-09-26 回「全开工」（第 4 条，A 级：新表 + 迁移）；设计稿 v3 经子牙、魏征设计审；实施审（子牙 + 魏征 + 狄仁杰）后按 5 条改完。本卡只管 PR-A（写入），PR-B（读方切换）另开卡。
迁移已按 PM 2026-09-27 在对话里的授权 apply（2026-09-26 13:27 UTC，库里迁移名 gsc_page_daily）；apply 后核过：两表 RLS 开、只有 service_role 策略，公开钥匙读写都被拒（42501）。
生产只读探测（同一授权，2026-09-26 13:29 UTC，CTS 9/24）：126 个页面一次拉全；逐页点击 30 = 全站 30；逐页展示 2,285 ≥ 全站 2,062；没触发授权刷新，全程没写库。verify_by 2026-09-27 = 合并部署后第一次 18:30 UTC 自动运行（新西兰 9/27 07:30）。
迁移未 apply：apply 前要 PM 在对话里点头；建议先 apply 再部署，部署后去 Inngest 后台重新 Sync。
已当场试跑（本机、替身谷歌接口、按表建模假库）：多天派单、翻页、撞谷歌 5 万行上限、429、403、写库失败、超长网址、停派报红一次、onFailure 只收自己那一单都走通；真实拉取和第②条的逐页对账要等生产授权。
