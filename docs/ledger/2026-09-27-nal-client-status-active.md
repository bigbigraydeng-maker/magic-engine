---
id: 2026-09-27-nal-client-status-active
title: NAL 在库里被标成「潜在客户」，被 9 个定时任务静默跳过——PM 授权改成正式客户，已改
status: verified
owner: pm
decided_on: 2026-09-27
source: session:5b9407a2
done_on: 2026-09-27
done_ref: commit:4b3e958a
verify_by: 2026-09-29
verify_how: 跑 `select client_status from clients where id='4ae76381-cd45-43bd-85cd-98cfd7604007'` 必须是 active。再看 NAL 有没有进那几个每周任务：`select job_name, started_at from cron_run_logs where job_name in ('keyword-snapshots-weekly','ai-tracker-weekly','site-audit-weekly','goal-current-value-refresh') order by started_at desc limit 8`，然后确认这几次运行的处理清单里含 NAL。另外查 `select current_value, current_value_fetched_at from goals where client_id='4ae76381-...' and status='active'`——不再是 null 才算真通
last_checked: 2026-10-15
check_note: client_status=active；关键词快照 10-12 写入 NAL；目标当前值 171（10-14 刷新）
verified_ref: doc:docs/ledger/evidence/2026-09-27-nal-client-status-active--2026-10-15.md
---
**PM 2026-09-27 授权，已执行：`clients.client_status` 由 `prospect` 改成 `active`，1 行。** PM 原话「改 / NAL 现在也是正式客户」。

## 根因

NAL 最近 30 天投了 **NZ$4,497** 广告、CRM 里 197 个人，但库里标的是 `prospect`。代码里 **38 处**按这个字段过滤，至少 **9 个定时任务**只对 `active` 客户跑 —— 所以 NAL 一直被静默跳过：网站体检、关键词排名快照、AI 可见度追踪、口碑快照、目标当前值刷新……

发现路径：PM 问「NAL 的月目标 300 开聊怎么显示」→ 查到目标行早就建好（口径 `messaging_started`、目标值 300、状态 active）、口径在目录里、取数函数支持、定时任务昨天 17:30 也跑了 —— **唯一的问题是 NAL 不在名单上**。

## 同一个毛病还有一个客户

**Magic Picks** 也是 `prospect`，最近 30 天花了 NZ$349。这次**没动它** —— PM 2026-09-27 明确说「先忽略 magic pick」，CRM 这条线只聚焦 CTS 和 NAL 两个客户。

## 改完当场试跑，以及一个没解决的口径问题

走生产同一条路（`autoFetchMetricValue` → `fetchAdsOutcome`，跟每天 17:30 那个任务调的同一个函数）：

- ✅ 取数成功了，来源 `ad_daily_insights`
- ⚠️ **但值是 0** —— 因为那个目标的周期是 **2026-09-27 → 2026-10-26**，从建行那天起算的滚动 30 天，而今天就是 9-27。
- 对比：**9 月整月（统到 26 日）广告带来的开聊是 213 个**，花费 NZ$1401。

**PM 当天回「自然月」，已改**：周期设成 `2026-09-01 → 2026-09-30`，再按生产同一条路验一次 —— **屏幕上现在是「开聊 213 / 300（71%）」，来源 `ad_daily_insights`。**

🔴 **10 月 1 日有个会触发的坑，已挡但没修完**：`goals-expiry-check` 只把过期目标标成 `expired`，**不创建下一个周期**。所以 10 月 1 日这条会过期，而**广告自治引擎要读这个目标定策略和预算**，NAL 又是 PM 9-24 授权的全权自治。
- 已建日历兜底：2026-10-01 09:00「查一下 NAL 的『开聊 300』有没有自动换成 10 月那一轮」，描述里带了手工补的 SQL
- 已派任务把自动换月做掉（`task_8c949ec2`），要求挂在已经在跑的 `goals-expiry-check` 里、幂等、只对标记为循环的目标换（不许凭「上个月有」就无限续期）

🔴 顺带记一条教训：第一版试跑脚本给 `goalPeriod` 传了 `{ start, end }`，而生产传的是 `{ period_start, period_end }`，报 `invalid input syntax for type date: "undefined"`。**是脚本错、不是生产错** —— 差点把自己的 bug 当成生产故障报上去。照抄调用方那一行才对。
