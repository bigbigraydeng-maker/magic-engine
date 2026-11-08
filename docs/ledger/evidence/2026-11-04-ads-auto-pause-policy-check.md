# 广告「花钱没结果就暂停」的建议，是不是被授权规则悄悄拦下了 —— 生产库核实（2026-11-04）

**证据等级：只读查库 + 只读查代码。** 没改任何数据、没改客户设置、没碰 Meta。
取数时间：2026-11-04（NZ 当天上午），库：生产库（Supabase 项目 CrazyContent），代码：主干 73711c19。
查法：Supabase 只读 SQL（全部 SELECT）；Render 环境变量只看名字和长度，没读值。
窗口：135（只读调查，PM 对只读调查有常设授权）。

## 一句话结论

**否 —— 授权规则一条都没拦过，因为建议从来没走到授权那一步；但它们确实没进 PM 待办。**
CTS 近 30 天有 3 条「花钱没结果」命中（10-27、10-29、11-03），全部停在更前面的「演练开关」上，记成了「演练记录」，
PM 待办只收「等批准」的，所以这 3 条 PM 也看不到。NAL 的自动暂停功能整个没开，一条记录都没有。
审查里怀疑的那条「规则配成自动 → 内核直接拒 → 记 blocked → 不进待办」的路，代码里确实存在，
而且两家的规则现在就是「自动」——**只要有人把演练开关关掉，下一次命中就会走进这条路，被拒、不进待办。**
现在它是一颗还没踩到的雷，不是已经发生的事故。

## 背景（审查里的疑点，代码核对结果）

| 位置 | 代码说的 | 核对 |
|---|---|---|
| `src/lib/kernel/registry.ts` ≈241–276 | 动作 `ads.auto_pause_on_d3` 声明 `approval.mode='human_only'`（只能人点头） | 属实 |
| `src/lib/ads-strategy/autonomy/sync-policy.ts` 43–60 | 客户选「受限自动」时，除加钱类动作外，所有 `ads.*` 规则一律写成 `auto_approve`；暂停不是加钱类 | 属实 |
| `src/lib/kernel/authorize.ts` 396–409 | 对外动作 + 规则是 `auto_approve` + 动作声明 `human_only` → 直接拒，拒绝码 `outward_requires_human_policy` | 属实 |
| `src/lib/inngest/functions/ads-d3-auto-pause.ts` 422–429 | 内核拒了 → 账表记 `blocked` | 属实（任务说明里写的路径 `src/lib/action-submission/ads-d3-auto-pause.ts` 不存在，真文件在这里） |
| `src/lib/pm-todo/ads-auto-pause-items.ts` | 待办只读内核里 `pending_approval` 的记录 | 属实；`blocked` 和 `dry_run_logged` 都不进待办 |
| `src/lib/inngest/functions/ads-d3-auto-pause.ts` 384–390 / 484–486 | **在提交内核之前**还有两道闸：客户 `autopilot_enabled=false` 整个跳过；`autopilot_dry_run=true` 只记「演练」不提交 | 属实 —— 这是本次结论的关键 |

## 第 1 项：两家客户的编号

SQL：`SELECT id, name FROM clients WHERE id='c0000000-…' OR name ILIKE '%new asian%'`（2 行命中）

- CTS Tours NZ：`c0000000-0000-0000-0000-000000000000`
- New Asian Logistics（NAL）：`4ae76381-cd45-43bd-85cd-98cfd7604007`

## 第 2 项：两家的广告授权规则（`client_automation_policies`）

SQL：按两家 client_id、`action_key LIKE 'ads.%'` 取全部行（18 行：每家 9 条，`effective_to` 全部为空 = 永不过期）

| 动作 | CTS | NAL |
|---|---|---|
| `ads.auto_pause_on_d3`（花钱没结果就暂停） | **auto_approve**（9-26 建，10-30 最后同步） | **auto_approve**（9-26 建，之后没动） |
| `ads.pause_unit` / `ads.pause_campaign` / `ads.cut_unit_budget` / `ads.cut_campaign_budget` / `ads.swap_creative` | auto_approve | auto_approve |
| `ads.scale_unit_budget` / `ads.budget_move_plan` / `ads.add_retargeting_adset`（加钱类） | require_approval（11-03 11:07 改） | require_approval（11-03 11:06 改） |

意味着：10-19 记忆说的「9 个全是 auto_approve 永不过期」已经变了——11-03 第 3 刀 3a 上线后，3 个加钱类动作被机器改成了「要审批」；
剩下 6 个（含自动暂停）仍是「自动」。而自动暂停这个动作在代码里又声明「只能人点头」，两边矛盾，一旦真提交内核就会被拒。

## 第 3 项：两家的广告自动化开关（`ad_strategy_configs`）

SQL：`SELECT to_jsonb(t) FROM ad_strategy_configs t WHERE client_id IN (两家)`（2 行）

| 字段 | CTS | NAL |
|---|---|---|
| `autonomy_mode` | bounded_auto（受限自动） | bounded_auto |
| `autopilot_enabled` | **true** | **false** |
| `autopilot_dry_run` | **true**（演练） | true |
| `updated_at` | 2026-11-01 23:28 | 2026-09-24 13:25 |
| `qualified_stage_keys` 列 | 存在，有值：quoted / deposit_paid / paid_full / traveling_soon / trip_completed（11-03 写入） | 存在，空 |

意味着：
- 11-03 那次数据库表改动（给 `ad_strategy_configs` 加「合格客人阶段」一列）**已经上了生产**，CTS 也已填好。
- CTS 自动暂停功能是开着的，但处于演练：命中了只记一笔，不提交内核。
- NAL 自动暂停功能根本没开，代码在读到 `autopilot_enabled=false` 时整个跳过，连演练记录都不写。

## 第 4 项：账表里的自动暂停记录（`flywheel_actions`）

SQL：`action_type='ads.auto_pause_on_d3'` 按 client_id、`payload->>'status'` 分组（近 30 天与全部历史结果相同）

| 客户 | 状态 | 条数 | 时间 |
|---|---|---|---|
| CTS | `dry_run_logged`（演练记录） | 3 | 10-27 17:01、10-29 17:01、11-03 17:02（均 UTC；NZ 次日早上 6 点） |
| CTS | `blocked` / `awaiting_approval` / `failed` | 0 | — |
| NAL | 任何状态 | 0 | — |

`blocked` 最近 5 条：**0 行，查不到** —— 不是查法问题，是从来没写过这种状态。
3 条演练记录的 `reason` 原文全部是：「如果 autopilot_dry_run 关闭，会提交 Kernel 等人批准暂停这个广告组」。
对应广告组（ID 只写尾号）：10-27 → 「7274 · 新客 NZ 45-65 · 表单 · 组A」(…950307)；10-29 → 「7274 · 老客户再营销 NZ 45-65 · 表单 · 组B」(…360307)；11-03 → 「7274 · 新客 NZ 50+ · 表单 · 组E · China Panorama 视频」(…330307)。

意味着：近 30 天 CTS 有 3 次「该暂停」的建议，都在演练开关这一步停下，没人被问过。

## 第 5 项：内核的提交与授权记录（`action_runs` / `authorization_decisions`）

SQL：
- `action_runs WHERE action_key='ads.auto_pause_on_d3'`（全部历史）→ **0 行**
- `authorization_decisions WHERE action_key='ads.auto_pause_on_d3'`（全部历史）→ **0 行**
- `authorization_decisions WHERE deny_code='outward_requires_human_policy'`（近 90 天、任何动作）→ **0 行**
- 近 30 天所有 `ads.*` 的授权记录 → 2 行，都是 NAL `ads.pause_campaign` 10-18 两次 `allow`（跟本题无关，列出只为证明这张表在正常写）
- 近 4 周每周新增「等批准」(`pending_approval`) 的自动暂停记录 → **每周 0 条**

意味着：
- 「PM 每周要批几条自动暂停」的真数是 **0**，不是因为没命中，是因为命中都没提交到内核。
- 那条「规则配成自动 → 内核直接拒」的拒绝码，90 天内对任何动作都没触发过一次。

## 第 6 项：广告组日数据里的 7 天频次（`ad_daily_insights`，`level='adset'`）

SQL：`count(frequency_7d)` vs `count(frequency)`（列名已用 information_schema 核实，日期列叫 `insight_date`）

| 范围 | 总行数 | `frequency_7d` 非空 | `frequency` 非空 |
|---|---|---|---|
| 全部（2026-08-16 ～ 11-03） | 373 | **0** | 354 |
| 近 30 天 | 104 | **0** | 99 |

意味着：预计「7 天的是 0」属实——7 天频次这一列从来没被填过，任何靠它判断「素材看腻了」的规则现在等于不存在。

## 第 7 项：广告组状态快照里 `effective_status` 为空的占比（`ad_entity_snapshots`）

SQL：`level='adset' AND captured_at >= now() - 14 天`（快照时间列叫 `captured_at`）

- 近 14 天广告组快照：1040 行（10-21 00:31 ～ 11-03 18:30 UTC）
- `effective_status` 为空：**0 行（0.0%）**；`status` 为空：0 行

意味着：这一项没有问题，Meta 给的「实际投放状态」每行都有。

## 第 8 项：Render 上「批准花钱的人」邮箱名单（`ADS_SPEND_APPROVER_EMAILS`）

查法：本机 `.env.local` 里有 Render 只读钥匙 → 调 Render 接口列 `crazycontent` 服务（`srv-d79s6d95pdvs73boptcg`）的环境变量，`jq` 只输出变量名和值的长度，**没读、没打印值**。

- 存在：**是**。值长度 23 个字符，逗号分隔后 1 个条目（= 配了 1 个邮箱）。
- 代码里读它的地方：`src/app/api/clients/[id]/meta-ads/execute/route.ts:112`（重开广告 = 重新花钱，只认这个名单）、`src/app/api/clients/[id]/ad-health/budget-change/route.ts:52`。

意味着：「没配名单所以谁都批不了」这个可能性排除。

## 结论：自动暂停建议是否在被悄悄拦下 —— **否（规则没拦过），但演练开关拦了，同样没进待办；雷已埋好**

证据行号：
- 规则没拦过：第 5 项，`action_runs` 0 行、`authorization_decisions` 0 行、拒绝码 90 天 0 次。
- 建议确实没到 PM 眼前：第 4 项，CTS 3 条 `dry_run_logged`（10-27 / 10-29 / 11-03）；第 3 项 `autopilot_dry_run=true`；`src/lib/pm-todo/ads-auto-pause-items.ts` 只收 `pending_approval`。
- NAL 一条都没有：第 3 项 `autopilot_enabled=false` + `ads-d3-auto-pause.ts:484-486` 整个跳过。
- 雷：第 2 项两家 `ads.auto_pause_on_d3 = auto_approve`（永不过期）+ `registry.ts` 声明 `human_only` + `authorize.ts:396-409` 会拒 + `ads-d3-auto-pause.ts:422-429` 记 `blocked` + 待办不收 `blocked`。**关掉演练开关的那一刻，这条路就通了。**

本文件只记事实，不提修法；修不修、先修哪个由 PM 决定。候选的两处矛盾点供下一步讨论：
① 同步规则对「只能人点头」的动作仍写 `auto_approve`（`sync-policy.ts` 的 `targetModeFor` 只对加钱类例外）；
② 演练记录和被拒记录都不进 PM 待办（`ads-auto-pause-items.ts`）。
