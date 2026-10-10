# 证据 · 2026-09-25-b2-simaqian-reputation-weekly · 2026-10-09

fetched_at: 2026-10-09T22:10:00+13:00（生产库 CrazyContent 只读查询 + 主干 b9a32592d 代码核对）

查了什么：verify_how 两条——①合并后第二个周四 cron_run_logs 有 completed 行且 summary.clients 是数组；
②当周五早上今日待办邮件里出现「司马迁：」条目。合并日 2026-09-25（周五 NZ），之后的周四是 10-01 与 10-08。

数字（带样本量、两边取数状态）：
- 条件①直接查到，样本 2 次运行（这是该任务在库里的全部记录，无其它行）：
  - `job_name=simaqian-reputation-weekly`，started_at 2026-09-30 20:03:02 UTC（= 10-01 09:03 NZDT 周四），
    status=completed，processed=10，summary.clients 类型 array，长度 10；各客户回执：
    8 家 no_new_reviews、1 家 drafted（2 条新评价）、1 家 draft_failed（1 条新评价）；summary.no_publish=true。
  - started_at 2026-10-07 20:01:41 UTC（= 10-08 09:01 NZDT 周四），status=completed，processed=10，
    summary.clients array 长度 10；9 家 no_new_reviews、1 家 drafted（1 条新评价）；no_publish=true。
  - 「有新评价的客户至少 1 家」这条样本门槛两周都满足（10-01 两家、10-08 一家），所以第②条也要验。
- 条件②：周五早上那封邮件本身不存档正文，只有运行回执，所以分两步取证：
  - 直接查到：`job_name=pm-daily-todo` started_at 2026-10-08 19:01:10 UTC
    （= 2026-10-09 08:01 NZDT 周五），status=completed，summary={"sent":true,"weekday":5,"total_items":128}。
    即这一封周五早上的邮件确实发出去了。
  - 推导（无自由变量）：`src/lib/pm-todo/simaqian-review-items.ts` 的 `fetchSimaqianTodos`
    取该任务最新一行回执（即 10-07 20:01 那次），要求 status==='completed'（满足）、
    回执新鲜度 `daysSince(finished_at) ≤ SIMAQIAN_RECEIPT_FRESH_DAYS=6`
    （10-08 19:01 UTC 减 10-07 20:02 UTC ≈ 0.96 天，满足）、clients 是数组（满足）；
    逐客户 `buildSimaqianTodo` 对 status==='drafted' 产出一条
    `simaqian_review_drafts`、what 以「司马迁：」开头（第 84 行），
    `five-kinds.ts:134` 把该 kind 归入 `review`（「要你拍板」车道）。
    10-08 那次有 1 家 drafted，所以这封邮件里有且仅有 1 条「司马迁：」条目。

来源/命令：
- Supabase 只读 SQL（project CrazyContent / glbdnayojixmexgofbsd）：
  `select job_name,status,started_at,finished_at,processed,jsonb_typeof(summary->'clients'),jsonb_array_length(summary->'clients') from cron_run_logs where job_name ilike '%simaqian%' order by started_at desc`
  及逐客户 `jsonb_array_elements(summary->'clients')` 展开、
  `select ... from cron_run_logs where job_name='pm-daily-todo' and started_at >= '2026-10-07'`
- 代码：`src/lib/pm-todo/simaqian-review-items.ts:60-140`、`src/lib/pm-todo/five-kinds.ts:134`、
  `src/lib/inngest/functions/simaqian-reputation-weekly.ts:32`、`src/lib/cron/registry.ts:244`
  （pm-daily-todo 排程 `0 19 * * 0-4` UTC = 周一至周五 08:00 NZDT）

结论：成。周巡连续两个周四都跑成且回执是数组，周五早上的待办邮件确实发出；
条目出现这一步是生产回执 + 代码分支的确定性推导（邮件正文不存档，无法直读）。
