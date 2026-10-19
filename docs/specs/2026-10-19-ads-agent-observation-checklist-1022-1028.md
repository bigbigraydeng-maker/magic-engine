# 广告 Agent 观测清单 · CTS 10/22–10/28 真实投放（119 号 · 2026-10-19）

依据：18 号统筹裁定（2026-10-19）。承接 [测试清单](./2026-10-19-ads-agent-test-checklist.md)（T1–T7）的 T1 / T2 / 回执读回，用 **CTS 10/22 这套真实投放** 当测试案例，**不另起一套、不另花钱**。
风险级别：C（只写文档；观测全部只读）。

## 0. 边界（先看这一节）

- **建 / 开由人**：74 号已建好两个系列的草稿，PM 本人 10/21 晚开。我负责 **看 → 判 → 验 → 回**
- **不碰**：74 号建的两个 `20261022` 系列和 A 草稿；NAL；不翻 `autopilot_dry_run`（保持 true）；不改任何设置
- **D3 自动暂停、止损只测"人点止损"这条路，不让 Agent 自己动手**（没有可靠急停，见 `docs/ledger/evidence/emergency-stop-and-cost-cap--2026-10-19.md`）
- **没有新功能**。本清单只规定"读什么、期望什么、不符怎么算缺陷"

## 1. 开投前基线（生产库 + Meta 官方连接实读，2026-10-19）

| 项 | 实读值 |
|---|---|
| 官方账户 | `act_2202695063810470`，`account_status=1`（正常），时区 Pacific/Auckland，账户日上限 11000 分（$110），客户总闸 $150 |
| 个人账户 | `act_2775766642787274`，`account_status=3`（欠款），**不用、不碰** |
| 近 14 天官方账户花费 | **0**（最后一笔 2026-09-22） |
| 10/22 系列 ① | `CTS · 拉新 · 表单 · 20261022`，id `52557922885873`，OUTCOME_LEADS，日预算 **$81**，**PAUSED** |
| 10/22 系列 ② | `CTS · 收割 · 表单 · 20261022`，id `52557922870873`，OUTCOME_LEADS，日预算 **$20**，**PAUSED** |
| 合计日预算 | **$101**（≤ 账户上限 $110，≤ 客户总闸 $150） |
| 草稿（未发布） | `CTS · 官网点击 · Natural China 3/26 · 20261022`（LINK_CLICKS，EDITING，校验通过） |
| 官方账户里另有 3 个 **ACTIVE** 的旧系列 | `GC · 再营销收割测试`×2、`GC · 顶层认知 · 视频观看`；**但近 14 天零花费**——开投前要先弄清它们为什么 ACTIVE 却不花钱（见 D0-3） |
| 素材池 | 5 条，过审 2 条（`28843889985273791`、`3626096160888481`）、候选 3 条 |
| 目标成本 | 主结果 `lead`，`target_cost_per_primary = 11` |
| 开关 | `autonomy_mode=bounded_auto`，`autopilot_enabled=true`，`autopilot_dry_run=true`；9 个 `ads.*` 策略全是 `auto_approve` |
| CTS 的 `ads.*` 执行记录 | 0 条 |

## 2. 数据怎么来的（读的时候别搞混）

- **`ad_daily_insights`（花费 / 线索 / 频次）**：每天 NZ 06:00 左右（`google-data-pullback-daily`，17:00Z）写入**前一天**。所以 **10/22 当天的数，10/23 早上才进库**。当天想看，只能读 Meta 官方连接（`ads_get_ad_entities`，实时）
- **`ad_entity_snapshots`**：每天抓 4–5 次，`capture_reason` 有 `first_seen / changed / daily / kernel_pre`
- **`ad_health_narratives.payload.portfolio_diagnoses.diagnoses[]`**：每天一行，含 D3 / D7 等判据结论
- **熔断探针**：`cron_run_logs` 里 `job_name='google-data-pullback-daily'` 的 `summary->'circuit_probe'`（**只读，不是刹车**）
- **追踪就绪**：读 `cloud-ads-tracking-preflight` 的回执（形状 `{overall, gates[{key,status,reason,evidence,as_of,hard}], no_publish:true}`，见 [预检设计稿](./2026-10-19-ads-tracking-preflight-workflow.md) §3）。**"数据在流"这一项直接引它，不重复造**；回执落在哪、字段是否如设计，**待该函数上线后我第一次读时核实，不提前假设**

## 3. 逐日观测表

> 读法统一：先读 Meta 官方连接实时值作为"真相"，再读库里 ME 看到的值；**两边对不上才算缺陷**。"期望"是我定的合理区间，不是 Meta 保证。

### D0 · 10/21 晚（PM 开投前后）

| # | 读什么 | 期望 | 不符怎么算 |
|---|---|---|---|
| D0-1 | 两个 `20261022` 系列 `effective_status`（Meta 实时） | PM 开投前 `PAUSED`；开投后两个都 `ACTIVE`，**且没有别的系列被误开** | 开投后仍 PAUSED 属人为未操作，**不算缺陷**；多出未授权的 ACTIVE 系列＝**缺陷 P0** |
| D0-2 | `ad_entity_snapshots`（`level in (campaign, adset)`，`ad_account_id='act_2202695063810470'`）下一轮抓取是否出现这两个系列 | 开投后 ≤ 1 个抓取周期（约 6 小时）内出现，`effective_status` 与 Meta 一致 | 超时仍无 / 状态不一致 → **缺陷**（T1） |
| D0-3 | 3 个旧 ACTIVE 系列：它们下面广告组 / 广告的 `effective_status`、预算 | 能说清"为什么 ACTIVE 却零花费"（例如广告组已停、无预算、账户曾欠款）；**若它们会在 10/22 随账户一起开始花钱，必须在开投前告诉 18 号** | 无法解释＝**记为风险，不算缺陷**，写进当日观测记录 |
| D0-4 | `action_runs` 里 CTS 的 `ads.*` | 仍为 0 条（Agent 没自己动手） | 出现任何非人点的新记录＝**缺陷 P0**，立刻停 |
| D0-5 | 追踪就绪回执 `overall` | 无硬门红灯；有红灯由预检工作流出待办 | 引用其结论；红灯＝开投阻塞，**不算 Agent 缺陷** |

### D1 · 10/22（开投首日）—— 当天读实时，次日早读库

| # | 读什么 | 期望 | 不符怎么算 |
|---|---|---|---|
| D1-1 | Meta 实时：两系列当日花费 | 各系列 0 < 花费 ≤ **日预算 × 1.3**（实测 Meta 可超投到约 1.31 倍；首日常常花不满） | 超过 1.3 倍＝**风险**，记观测；超过账户日上限 $110＝**缺陷 P1** |
| D1-2 | 次日（10/23）`ad_daily_insights`（`level='campaign'`，`insight_date='2026-10-22'`）两系列各一行 | 有行，且 `spend` 与 Meta 实时的 10/22 数据差 ≤ 1% | 缺行 / 差距大＝**缺陷**（T2 取数） |
| D1-3 | 10/23 `ad_health_narratives`（`insight_date='2026-10-22'`）CTS 一行 | 有；`payload.portfolio_diagnoses` 列出 D 系列结论；**D7（授权 / 数据体检）无"账户异常"** | 缺行＝**缺陷**；D7 报账户欠款而 Meta `account_status=1`＝**缺陷**（误报） |
| D1-4 | D3「花钱没结果」 | 首日花费很少，**预期 `not_comparable` 或无命中**（它看近 7 天，需花费 ≥ 2×$11=$22 才可能命中） | 首日就 hit＝**核对是否合理**（见 D3 判据，下） |
| D1-5 | 频次 `frequency`（广告级 / 系列级） | 首日 ≤ 3（后台红线 3） | > 3 且系统没提示＝**缺陷** |
| D1-6 | 熔断探针 `circuit_probe` | CTS 官方账户的 `accountCapCents=11000`，**不再是 `cap_missing`**；`spendCents` 有值 | 仍 `cap_missing` / `spend_missing` 超过 1 天＝**缺陷** |

### D2–D3 · 10/23–10/24（读 T2 的主要窗口）

| # | 读什么 | 期望 | 不符怎么算 |
|---|---|---|---|
| D2-1 | 日花 vs 日预算 | 趋于日预算的 70%–110%；连续两天 < 30% 要标"花不动"（观测，不是缺陷） | — |
| D2-2 | 线索数与线索价 | `leads`、`cost_per_result` 在 `ad_daily_insights` 里有；**线索价与 $11 对照**：> $22 要看 D3 是否提示 | 线索价 > $22 且花费 ≥ $22，D3 **没有 hit** 也没解释＝**缺陷**（判据漏判） |
| D2-3 | D3 判据一致性（我独立算一遍） | 我用 `ad_daily_insights` 近 7 天自己算"花费 ≥ 22 且 每结果成本 ≥ 22（零结果也算）"，与 `portfolio_diagnoses` 里 D3 的 hit / healthy 是否一致 | 不一致＝**缺陷 P1**（判断与原始数据矛盾） |
| D2-4 | 人是否被提示 | 如果 D3 hit，`flywheel_actions` 出现 `dry_run_logged` 行（演练模式，不动手）；今日待办有"需要你动手" | hit 但无记录 / 无待办＝**缺陷**（发现死在日志里） |
| D2-5 | `action_runs` 的 CTS `ads.*` | 仍只有人点止损产生的记录（若 PM 没点则 0 条） | 出现非人点记录＝**缺陷 P0** |

### D4–D7 · 10/25–10/28（稳定性与周结论）

| # | 读什么 | 期望 | 不符怎么算 |
|---|---|---|---|
| D4-1 | `cron_run_logs` `google-data-pullback-daily` 每天 `status=completed` | 连续 7 天 completed；`summary.errors` 里 CTS 相关错误 ≤ 0 | 任一天 failed＝**缺陷**；有 CTS 错误＝**缺陷** |
| D4-2 | `ad_health_narratives` 连续不断档 | 10/22–10/28 每天一行 | 断档＝**缺陷** |
| D4-3 | 账户状态 | `account_status` 全程 = 1 | 变成 3 / 其它，系统**必须**当天提示（D7 / 待办）；没提示＝**缺陷 P1** |
| D4-4 | 人点止损（如 PM 点了） | 该次 `action_runs` + 三步 + `authorization_decisions` 齐；**注意：止损按钮不写 `flywheel_actions`（已登记 P3 缺口，不重复算缺陷）** | 记录不齐＝**缺陷** |
| D4-5 | 周小结（10/28） | 我出一页：开投后每天花费 / 线索 / 线索价 / 频次 / D 系列结论 / Agent 提示了什么 / 漏了什么 | — |

## 4. 缺陷怎么记

- **认定**：满足任一条即缺陷——①应该有的行 / 提示没有 ②Agent 的结论与原始数据矛盾 ③出现不该有的 `ads.*` 执行记录 ④ME 看到的与 Meta 实时对不上
- **不是缺陷**（只记观测）：人没按时操作；Meta 自己的延迟；首日花不满；已登记的已知缺口（止损不写飞轮 P3、没有急停 P2）
- **记在哪**：每个缺陷一张台账卡 `docs/ledger/<日期>-ads-obs-<短名>.md`，`status: decided`，`verify_how` 写"怎么复核已修好"；标题写人话；正文 ≤ 5 行（台账校验限制）
- **分级**：按 §11 三维打分亮过程；**P0 / P1 当天告诉 18 号**，其余汇总进周小结
- **立刻停的情形**：出现未授权的 `ads.*` 执行记录；误开未授权系列；花费超过账户日上限——**停下来、告诉 18 号**，由 PM 决定，我不自行处置

## 5. 我每天怎么读（只读，示例）

```sql
-- D1-2 / D2-1：CTS 官方账户系列级花费与线索（库里的值，次日早上才有前一天）
select insight_date, entity_name, spend, leads, results, cost_per_result, frequency
from ad_daily_insights
where client_id = 'c0000000-0000-0000-0000-000000000000'
  and ad_account_id = 'act_2202695063810470' and level = 'campaign'
  and insight_date >= '2026-10-22' order by insight_date, entity_name;

-- D1-3 / D2-3：当天体检里的 D 系列结论
select insight_date, d->>'code' as code, d->>'status' as status
from ad_health_narratives n,
     jsonb_array_elements(n.payload->'portfolio_diagnoses'->'diagnoses') d
where n.client_id = 'c0000000-0000-0000-0000-000000000000' and n.insight_date >= '2026-10-22'
order by insight_date, code;

-- D0-4 / D2-5：是否有不该有的 ads.* 执行记录
select id, action_key, status, triggered_by, created_at
from action_runs where client_id = 'c0000000-0000-0000-0000-000000000000' and action_key like 'ads.%'
order by created_at;
```

另读 Meta 官方连接 `ads_get_ad_entities`（`level=campaign`，`object_ids` 填两个系列 id，字段 `effective_status / daily_budget / amount_spent / frequency / results / cost_per_result`）取实时值。

## 6. 未核实 / 局限

1. 追踪预检回执的存放位置与字段，待 `cloud-ads-tracking-preflight` 上线后第一次读时核实
2. 「首日花费 ≤ 日预算 × 1.3」的系数来自 NAL / CTS 过去的观察（最高 1.31，样本小，见 `2026-10-19-ads-cross-account-daily-spend-gate-v0.2.md`），**是观测阈值，不是规则**
3. 3 个旧 ACTIVE 系列为什么零花费，我还没查清（D0-3 要先弄清）
4. 全程只读：不能证明"Agent 自己动手"这一段，那一段本轮不测
