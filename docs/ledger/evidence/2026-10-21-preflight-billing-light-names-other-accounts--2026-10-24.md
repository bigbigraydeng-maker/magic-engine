# 证据：2026-10-21-preflight-billing-light-names-other-accounts · 取数 2026-10-24（线上运行记录，只读）

- 取数：生产库 `cron_run_logs`，任务名 `ads-tracking-preflight`，最近 6 条（新西兰时间 10-21 01:12 至 10-24 07:00），只读 SELECT。
- 上线：PR 3032（主线提交 `7b3bbd43a`，10-21 14:57 新西兰时间合入；Render 部署 15:03 live）。
- 合并后三次自动运行（10-22、10-23、10-24 各早上 07:00），CTS 的 `env.account_billing` 这一道门：
  - 三次都是**黄灯**；原因文字都含「尾号 7274」「已在广告健康页隐藏」「账户欠款」（即点名了旧个人账户）；
  - evidence：`other_accounts_read = true`、`other_live_daily_budget_cents = 11500`、`other_accounts_error = null`（三次一致）；
  - 本账户在投日预算合计：10-22 为 134.00 NZD，10-23 和 10-24 为 84.00 NZD（官方账户后来把预算调低过），所以每次读到的本账户合计不同，旧账户那 115.00 NZD 三次都在。
- 合并前最后一次（10-21 07:00）：黄灯，原因文字不含「尾号 7274」，`other_accounts_read` 为空——说明变化来自这次改动，不是巧合。
- 判据逐条：灯为黄并点名旧个人账户（尾号、已隐藏、欠款）✓；`other_accounts_read = true` ✓；`other_live_daily_budget_cents = 11500` ✓。
- 没有在线上观察到的一项：卡里「旧账户那 4 个系列被暂停后，下一轮应变绿」——10-24 07:00 时它们仍开着（11500 未变），没有机会看到转绿；这一支由单元测试覆盖（`other-accounts-text` 的 `none_open` 用例、判灯测试的“其它账户都没开着预算 → 绿”用例），线上等它们真被暂停后再看。
- 方法：取数脚本是临时文件，跑完已删除；没有写库，没有调 Meta。
