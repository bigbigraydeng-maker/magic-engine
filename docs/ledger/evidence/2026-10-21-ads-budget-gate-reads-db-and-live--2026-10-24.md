# 证据：2026-10-21-ads-budget-gate-reads-db-and-live · 取数 2026-10-24（线上运行记录 + 读代码 + 批准记录 + 一次函数级只读检查）

五项逐条（只读，没写库，没调 Meta 写接口）：

1. **早上 7 点的体检第一次自动跑完，预算门带数** ✓
   - 取数：生产库 `cron_run_logs`，任务名 `ads-tracking-preflight`，10-21 至 10-24 四次 07:00 自动运行。
   - 每次 CTS 的 `env.account_billing`：`budget_read = true`；`account_cap_cents = 15000`、`client_cap_cents = 15000`（都是 150.00 NZD）；`live_daily_budget_cents`：10-21 和 10-22 为 13400，10-23 和 10-24 为 8400；`registered_account_count = 2`。
2. **灯号与线上在投预算一致，2 个登记账户所以黄** ✓
   - 四次都是黄灯，与设计一致（本账户合计不超本账户上限；客户总上限没在这里核）。
   - 线上核对：10-21 10:58 用同一读法现读 Meta 得 134.00 NZD（与当天 07:00 的记录一致）；10-24 19:01 现读得 84.00 NZD（与当天 07:00 的记录 8400 一致）。
3. **批准前现读 / 计划页与派任务前复查**（读代码，主线 `d81d3fcc5`）✓
   - 推广计划批准路由 `src/app/api/clients/[id]/marketing-plan/[planId]/approve/route.ts` 第 88 行：`liveBudget: 'always'`（每次都现读）。
   - 计划页 `…/promo/route.ts` 第 43 行：`liveBudget: 'if_needed'`；往执行看板派广告任务前的复查 `src/app/api/clients/[id]/execution/route.ts` 第 685 行：`liveBudget: 'if_needed'`。
4. **存档超过 12 小时后，计划页的预算门是「刚现读」的灯** ✓
   - 函数级只读检查（真库、真 Meta；计划页用的就是这一层 `loadTrackingGateFacts`，选项 `liveMode: 'if_needed'`）：
     - 10-24 18:35：存档（07:00:18 那份）11.58 小时，没满 12 小时 → 没有现读（read_live = false），符合设计；
     - 10-24 19:01:44：存档满 12.02 小时 → 现读了 Meta，返回预算门黄灯、读取时间 19:01:44（就是刚才）、在投日预算合计 84.00 NZD、`budget_read = true`。
   - 计划页本身这次没有登录实看（页面显示的就是这一层的结果）。
5. **批准后的批准记录里有「批准时现读的」预算门** ✓（数据层）
   - 取数：`marketing_plans.generation_meta.approval_receipt.gate_snapshot`。CTS 的计划 10-21 09:23:02（新西兰时间）批准，回执里 `env.account_billing`：`source = "live"`、`as_of = 09:22:59`（批准前 3 秒现读）、灯 = 黄。
   - 页面上「广告账户与付款：批准时现读的」那一行由 `describeApprovalRecord` 渲染，10-21 做过函数级试跑；这次没有登录看批准记录页。

结论：五项都对上，没有对不上的项；没有在页面上亲眼看到的只有第 4、5 项的最后一步显示，数据层和函数层都核过。
