---
id: 2026-09-28-find-shared-ad-accounts-pagination-gap
title: findSharedAdAccounts 全表查询没分页——client_meta_ad_accounts 超过 PostgREST 单次上限时会静默截断，共享账户可能被误判独占
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-12
verify_how: 查 client_meta_ad_accounts 当前行数是否接近或超过 PostgREST 单次返回上限（Supabase 默认 db.max_rows=1000，以项目实际配置为准）；若已接近，立即按 §11 重新打分决定是否马上做；否则到期按 §11 重新打分排入 ROADMAP 或再展期
---
Codex 复审 PR #2019（熔断器运行时调用方 round 12）：`src/lib/meta/client-ad-accounts.ts:139-148` 的 `findSharedAdAccounts` 用一次 `.select('client_id, ad_account_id')` 查全表构造"哪些账户被多个客户共用"的集合，没有分页（`fetchAll` 式循环）也没有稳定排序。已核实这个描述准确——函数确实没有 `.range()`/`.limit()`/`.order()`。如果 `client_meta_ad_accounts` 的行数超过 PostgREST 单次返回上限，被截断丢掉的那部分行如果恰好包含"这个账户同时登记在另一个客户名下"的记录，该账户会被误判为独占，round 11 刚修的跨客户花费误算问题（熔断阈值把别的客户在共享账户上的花费也算进来）会在这种情况下原样复发。

**这条建议没有被立即采纳为代码改动**，用 CLAUDE.md §11 三维打分明示：

- **频率**：低。要触发需要 `client_meta_ad_accounts` 总行数超过分页上限，且被截断部分恰好包含相关的共享登记——当前客户规模（个位数到几十个客户，每客户 1-2 个账户）离触发门槛还很远。
- **IMPACT 闭环关键度**：高。一旦触发，后果和 round 11 刚修的原始 bug完全一样——熔断阈值把别的客户在共享账户上的花费错算进本客户名下，可能导致误触发熔断（客户广告被错误暂停）或该触发时反而没触发。
- **收入关联度**：高。真出现，直接是客户广告被误停或超预算没被拦下,两个方向都直接影响客户体验/资金安全。

→ 频率低，IMPACT 高，收入高：**恰好一个低、两个高 → P1**。

**为什么没在这个 PR 里现在就修**：`findSharedAdAccounts` 是复用的既有平台能力（`client-ad-accounts.ts`），不是这个 PR 新写的代码——这个 PR 只是新增了它的第 5 个调用方（另外 4 个是 `diagnostics/loader.ts`、`snapshot-sync.ts`、`ads-d3-auto-pause.ts`、`ai/live-rules.ts`）。要修对，需要给这个函数加 `fetchAll` 式分页（参考同文件里读花费数据已经在用的分页写法）或者把"判定账户属于谁"下沉到数据库侧一次性算完整,这样的改动会影响全部 5 个调用方,需要独立验证不会让其它 4 个既有场景回归,而不是"这个 PR 顺手改一行"能做对的事——尤其这个 PR 本身已经因为改动过大被 `fix-scope` 闸门标红,不适合继续在它里面追加跟"接线 cron 调用方"这个目标无关的平台层修复。

**下一步**（谁来接、接的时候要做什么）：给 `findSharedAdAccounts` 加分页循环（`fetchAll` 写法，参考 `circuit-breaker-spend.ts` 里读花费数据的既有分页实现）或改成数据库侧聚合查询；改完后跑一遍 4 个既有调用方（`diagnostics/loader.ts`、`snapshot-sync.ts`、`ads-d3-auto-pause.ts`、`ai/live-rules.ts`）+ 本 PR 新增的 `circuit-breaker-spend.ts` 的测试,确认没有因为改分页方式引入行为变化。这是一次独立的平台层小修复,不依赖这个 PR 是否已合并。
