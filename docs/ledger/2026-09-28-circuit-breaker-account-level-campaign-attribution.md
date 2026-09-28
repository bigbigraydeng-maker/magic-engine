---
id: 2026-09-28-circuit-breaker-account-level-campaign-attribution
title: circuit-breaker-spend.ts 按账户汇总花费没做系列（campaign）级归属过滤——单一登记账户里混进别的客户的系列会污染判定
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-12
verify_how: 查 client_meta_ad_accounts 里当前每个账户是否仍只登记给一个客户但账户内混有其他客户系列（`ad_daily_insights` 按 ad_account_id 分组、按 entity_id 对照 Meta 后台系列归属核对）；`20260721000001_ad_daily_insights.sql` 里点名的 CTS 账户 2775766642787274 内的 4 条 Oztop 系列是否仍是活跃/花费为零，若已产生真实花费立即按 §11 重新打分
---
Codex 复审 PR #2019（熔断器运行时调用方 round 13）：`circuit-breaker-spend.ts:91-160` 的 `fetchClientDailySpendCentsByAccount` 按 `client_id` + `level='campaign'` 读 `ad_daily_insights` 后，直接把同一 `ad_account_id` 下全部行的 `spend` 相加当作"这个账户当日花费"。round 11 已经排除了"同一账户登记给多个客户"的情况（`findSharedAdAccounts`），但这条指出一个不同的场景：一个账户即使**当前只登记给这一个客户**，账户内部仍可能混着历史遗留的、实际属于别的客户的系列（campaign）。

已核实这是真实存在的数据形状，不是猜测：`supabase/migrations/20260721000001_ad_daily_insights.sql:16-22` 的表注释原话——"CTS's account 2775766642787274 still carries 4 legacy Oztop campaigns (~$175 over 90d, zero spend in the last 7d; confirmed by PM 2026-07-20 as historical spillover from before Oztop had its own account). Any account-level rollup MUST aggregate from filtered campaign rows rather than trusting an account-level total." 也就是说：这张表从设计时就知道会出现"一个账户、多个客户的系列混杂"，并且明确要求账户级汇总必须先按系列过滤归属——`circuit-breaker-spend.ts` 目前没有做这层过滤，直接违反了这条表注释写明的使用前提。

**这条建议没有被立即采纳为代码改动**，用 CLAUDE.md §11 三维打分明示：

- **频率**：低。触发需要"账户内混有别的客户的系列"且"那些系列产生了真实的、会被判定异常的花费"两个条件同时成立。目前唯一有记录的实例（CTS 账户里的 4 条 Oztop 系列）在迁移文件写下时是"过去 90 天约 $175、近 7 天零花费"——处于休眠状态，短期内不会触发 3 倍中位数这类相对阈值判据。
- **IMPACT 闭环关键度**：高。一旦这类休眠系列重新产生花费，或者未来出现新的类似历史遗留场景，后果和 round 11 修的问题同构：别的客户的花费被算进本客户名下，可能误触发熔断（本客户广告被误停），也可能被拿来稀释本客户自己的真实异常从而漏判。
- **收入关联度**：高。真出现，直接是客户广告被误停，或该拦的异常花费没拦下。

→ 频率低，IMPACT 高，收入高：**恰好一个低、两个高 → P1**。

**为什么没在这个 PR 里现在就修**：核实过同一份 `ad_daily_insights` 的其它既有读者（`evaluate.ts:234-235`、以及这个文件自己的文档引用的 `goal-context.ts`/`own-ad-activity.ts`）用的是**同一种**"按 `client_id` + `level='campaign'` 过滤、不做系列级归属校验"的读法——这不是 `circuit-breaker-spend.ts` 独有的疏漏，是全平台对这张表的既有读取惯例都没有兑现表注释自己写下的要求。要修对，需要先搞清楚"系列归属"这个事实该从哪里来（`ad_daily_insights` 本身没有 owner 字段，需要新的归属映射，或者证实写入侧其实已经隐式做对了、只是没有强制约束），并且要同时改多个既有文件才不会造成"熔断判定过滤了、但 `evaluate.ts` 的健康诊断还在用未过滤数据"这种新的不一致——这是一个独立的、跨文件的平台层修复，不是"接线 cron 调用方"这个 PR 顺手带一句代码能做对的事。

**下一步**（谁来接、接的时候要做什么）：① 先查清楚 `ad_daily_insights` 写入侧（`google-data-pullback-daily` 或其上游同步逻辑）有没有可用的系列级归属信号（哪怕只是"这个系列所属的 campaign 名称/objective 能不能推断归属"），如果有就补一个真实的归属过滤层；② 如果写入侧确实没有归属信号，需要先决定这个归属事实要新建在哪（新表 / 手动登记的例外名单 / 人工审核任务），这是一次独立设计，建议先过一次子牙+魏征复审再动手（碰的是花费判定这一安全相关逻辑）；③ 无论选哪个方向，改完后 `circuit-breaker-spend.ts` 和 `evaluate.ts` 等既有读者要一起改，保持口径一致。
