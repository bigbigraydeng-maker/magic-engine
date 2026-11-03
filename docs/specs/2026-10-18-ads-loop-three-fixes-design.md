# 广告线闭环三处修复 · 设计 v0.2（只设计，未写代码）

- 日期：2026-10-18 ｜ 窗口：74 ｜ 来源：18 号 10-18「最小成本修三件」；起因是 74 号 10-18 广告线闭环登记表
- 状态：v0.2 = v0.1 + 子牙（架构）与魏征（挑刺）各一轮审查意见已并入。①② 可交 DeepSeek（B 级）；③ 只设计，A 级，须 PM 本人回「合 N」。
- 审查结论摘要：v0.1 的 ①② 各有一处会写错（判「能不能评」的条件、接线位置）；③ 按 v0.1 落地会让人按的止损失效、重同步不生效。以下全部改过。

## 先更正我登记表里说错的三处（读代码后）

1. 自治同步回执**不是每天写**：每个键已按当前 `ad_strategy_configs.updated_at` 同步过就被判「已同步」跳过，跳过的键不写回执（`sync-policy.ts:65-70,79`）。叫醒它的事件有两个来源：设置页改开关（`autonomy/notify.ts`）和每天的 `google-data-pullback-daily` 对账（`route.ts:569-572`）。所以 10-13 起没有新行是正常的，不是断档。
2. 加预算 `ads.scale_unit_budget` **不会**在 `auto_approve` 下无人批地执行：路由层先查策略（`o1-scale/route.ts:134-138`，不是 `require_approval` 直接 409），内核层再拒（`authorize.ts:555-565`，`outward_requires_human_policy`）。现状是「人批的加预算被拒」，不是「没人批就加了」。
3. `ads.auto_pause_on_d3` 的批准方式声明是**只认人工**（`registry.ts:271-279`），在 `auto_approve` 下被 `authorize.ts:381-391` 直接拒；也就是现状下 D3 一提交就被拒，不是「会直接执行」。真正可能在 `auto_approve` 下不经人批就执行的，是注册表里批准方式为 `bounded` 的 8 个键；我查过，目前只有人点按钮会提交它们，没有任何定时任务或 Inngest 以 signal/agent 身份提交（全仓只有 `ads-auto-pause.ts:63` 一处 signal）。

## 修复①：账户状态≠1 超过 24 小时 → 进今日待办（B 级）

- 现象：个人账户 10-11 起欠款停摆（状态 3），库里没有告警或待办。
- **复用，不另写一份**：作战地图已有「读每个账户最新状态、排除 `capture_reason='disappeared'`、36 小时过期、状态码 3 文案」（`war-map/load.ts:63-91`、`build.ts:43-55`、`actions.ts:15,33-41`）。把读账户那一段抽成共享小函数 `ads-strategy/account-status.ts`，作战地图与新待办共用，文案也共用，避免两边各说各话。
- 范围：只看当前仍登记的账户（`meta/client-ad-accounts.ts` 的 `getClientAdAccounts`）；已解绑账户即使最后一行快照还在也不出待办；共用同一账户的多个客户，待办 key = 客户 + 账户。
- 判「读没读到」：用 `ad_snapshot_captures` 里 `level='account'` 且 `complete=true` 的最近一次，**不用**快照表自己的时间戳（状态不变时快照只每日保底写一行，相邻行可隔约 30 小时，36 小时门槛太紧会误报）。读不到 = 一条单独的「账户状态读不到」，owner 归开发，不进 PM 清单。`account_status` 为 null（读失败）不能和 1 比较。
- 判「≠1 超 24 小时」：当前仍≠1，且从该账户状态第一次变成≠1 的那一行（向前找最近一行状态=1，复用 `promo-draft-facts.ts:62-71` 的 `accountStatusAsOf` 读法）算起满 24 小时才出待办；恢复为 1 自动消失。已关闭账户（状态 2/100/101）不出每日待办，改为每周一次「这个账户已关闭，是否解绑」。
- 接线：`pm-todo/manual-items.ts:388`（与 `pushAdsCircuitItems` 并列）；`manual-item-types.ts` 的 `ManualItemKind` 登记新种类；`five-kinds.ts:55` 的 `LANE_OF_KIND` 登记（异常那条归 `one_click`，「读不到」归 `dev`）。
- 文案（大白话）：what =「账户 X 的 Meta 广告账户状态不是正常（码 N，一般 3=欠款未结），已经 N 小时；这期间不会花钱、不会有新线索」；how =「去 Meta 付款设置看扣款失败原因，结清并补备用卡」；href = 该客户 `ads-health`。
- 不做：不改作战地图展示、不写任何账户。
- 测试：状态 1 无待办；状态 3 未满 24h 无待办；满 24h 一条且 key 含客户+账户；恢复后消失；`account_status=null` 走「读不到」；解绑账户不出；已关闭账户走每周；共用账户不重复。

## 修复②：flywheel 判好坏方向 + 不再给没执行过的建议判好坏（B 级）

根因（`attribution/job.ts` 的 `computeVerdict`）：没有 `expected_delta` 时「正向变化 = confirmed」，对越低越好的指标是反的；CTS 的 ads 动作 `expected_delta` 全空，所以线索价从 10.78 涨到 11.48（变差）被标 confirmed。

- **做法 A（极性）**：在 `flywheel/vocabulary.ts` 旁加一张极性表（单一来源）。**只在 `computeOutcomeVerdict` 里、且仅当 `expectedDelta === null` 时**，对「越低越好」的指标把 `delta` 和 `deltaPct` 取反再交给 `computeVerdict`。
  - 表内「越低越好」：`ads.account.cost_per_lead`、`ads.account.cost_per_conversation`、`ads.account.cpa`、`ads.account.cpc`、`geo.query.avg_rank`；「中性」（花费涨不等于好，一律 inconclusive）：`ads.account.spend`；其余默认越高越好。
  - **不要**用合成 `expectedDelta=-1`（会换到另一条判断路，置信度门槛 0.35 和上限 0.95 会变）；**不要**动 `computeVerdict` 的参数（`verdict-entry-point.test.ts:40-58` 锁死入口）。
  - `health/score.ts:59-77` 的 `lowerIsBetter` 改读这张表；加一条测试：极性表与 `HEALTH_METRICS` 每一项方向一致。
  - SEO 不会被翻转：`seo.gsc.avg_position`、`seo.ga4.*` 本来就被判为站级不可归因（`outcome-identity.ts:89,106-111`），GSC 评估器已自己反向并固定传 `expectedDelta=1`（`gsc-bridge.ts:610-631,693`）。加测试锁死「GSC 排名提升仍是 confirmed」。
- **做法 B（不评没执行过的建议）**：v0.1 用 `vendor`/`action_type` 字眼判断是错的——库里写入的 vendor 是 `'meta'`/`'meta_graph'`，真实动作名（`ads.pause_campaign`、`ads.auto_pause_on_d3` 等）不含 meta；而 v0.1 点名要评的 `diversify_meta_ad_creatives_*`、`reactivate_cold_start_*` 来自诸葛亮周计划写入（`zhuge/action-persister.ts:273-296`，`vendor: null`，`executed_at` 是建议生成时间），本身就是**没执行过的建议**。
  - 改为：复用 `attribution/execution-evidence.ts:33-37` 的 `isUnexecutedSuggestion`，并加一个标记：`payload.discovery_id` 存在 = 来自发现环节的建议。这类动作不进评估。
  - 位置：`job.ts` 的 `attributeOne` 里、分流判断**之前**加一个新出口 `not_evaluable`，只计数、不删旧结果、不生成待办。**不要**并入 `unattributable`：那条路会走 `reconcileLegacyWindows(id, null)` → `retireAbandonedMetrics`，把动作名下已有结果行硬删（`job.ts:198-207,491-525`，等于每 6 小时一轮就改生产数据），还会触发 `attribution-items.ts:140-167` 的「请修正指标」待办噪音。
  - 历史上 6 条被误判的 ads outcome 行：**不删不改**；是否清理由 PM 另批，可借用现成的 `outcome_rows_orphaned` 那张「删还是留」决定卡。
- 关于 `launch_google_ads_campaign` / `expand_to_google_ads` 等「已执行」行（结论）：**不是造假**，是建议/计划类行。证据：没有 `execution_item_id`、`production_package_id`、`action_run_id`；`execution_mode` 为 `external_manual`（等人去做）或 `in_house`（内部出的报告，如 6-11 的三份 Google 广告方案文档）；payload 里是 `discovery_id`、`why_now`、`evidence_refs`、`rank`；写入代码是 `zhuge/action-persister.ts`。「已执行」只表示「建议已派发/报告已出」，不表示 Google 广告开了；库里也没有 Google Ads 授权和 google 平台数据。风险是名字误导，不是数据假。`google-ads/execute/route.ts` 才是真能改 Google 广告的路径（vendor `google_ads`、执行方式 `third_party`），做法 B 的标记不能误伤它。
- 测试：极性（线索价 +6% = reversed，−6% = confirmed；点击 +6% = confirmed；显式 `expected_delta` 不变；spend 恒 inconclusive）；GSC 排名锁；`not_evaluable` 不删旧行、不出待办；`execution-evidence` 真执行动作仍被评。
- 未验证：CTS ads 动作 `expected_delta` 全空与 6 条错行是我 10-18 查库所得；极性上线后 `geo.query.avg_rank` 的历史结论口径会变，PM 需知情。

## 修复③（A 级，只设计）：广告动作的自治策略模式改成「按键、默认人工」

**真实现状（读码后）**：`bounded_auto` → `auto_approve` 对注册表全部 `ads.*` 键（9 个）一律生效（`sync-policy.ts:35`）。
- 人点按钮就执行的：止损（`pause_unit`、`pause_campaign`、`cut_unit_budget`、`cut_campaign_budget`，`stop-loss/route.ts:153`、`action-submission/stop-loss.ts:47`）、降预算（`meta-ads/execute/route.ts:231` → `inngest/functions/ads-campaign-budget.ts:51`）——这几条**靠 `auto_approve` 才能当场执行**。
- 现状被拒的：O1 加预算（要人批，`requireHumanApproval`）、D3 自动暂停（声明只认人工）——所以 `bounded_auto` 现在两头都不对。
- 通用审批页只签字、不执行（`kernel-approval/service.ts:4-11,627-650`），没有任何程序扫「已批准」的请求去执行；`dedicated-approval-entries.ts:33-38` 只登记了 D3。

**设计（改 v0.1 的「全部改人工」）**：
- 常量 `AUTO_APPROVE_ALLOWED_KEYS` 初始 = 4 个「收」类键：`ads.pause_unit`、`ads.pause_campaign`、`ads.cut_unit_budget`、`ads.cut_campaign_budget`（人点一下 = 人批，且仍走人工止损那套信封检查，`authorize.ts:440-460`；与 PM 10-10「停/减需人批」一致）。
- `bounded_auto` 下：这 4 个键 `auto_approve`，其余 5 个键（`auto_pause_on_d3`、`scale_unit_budget`、`budget_move_plan`、`add_retargeting_adset`、`swap_creative`）一律 `require_approval`；`observe` 下全部 `require_approval`（不变）。`deny` 永不覆盖（不变）。
- 效果：O1 加预算不再被拒、可走正常人批；D3 变为可批准（修好而不是改坏）；挪预算/加受众组/换素材本来就没有自动调用者，默认人工；急刹车保留。
- **不改 Kernel 一行。**
- **生效方式（v0.1 的「发一次事件」不生效，已更正）**：判「已同步」是 `last >= source(updated_at)`（`sync-policy.ts:70`）。新增常量 `MAPPING_EFFECTIVE_AT`（本次合并日），`planAutonomySync` 的有效 `source = max(updated_at, MAPPING_EFFECTIVE_AT)`；这样旧回执一律过时，**下一次事件（设置页保存或每天凌晨 `google-data-pullback-daily` 对账）就自动生效**。所以**真正的 PM 批准点是「合并」本身**，不是之后的某次重同步，这点写进 PR 与待办。
- **在途待批准会被作废**：策略 `auto_approve`→`require_approval` 使规则版本号 +1，人批时核对版本不一致即拒（`human-approval.ts:220-228`，`stale_policy_version`）。合并前先查有没有挂着的 `ads.*` 待批准；若有，合并后需重新提交。回滚同理。
- **待批准没有过期时间**（`authorize.ts:585` `expires_at: null`）：D3 的幂等键带诊断日期，一旦关掉演练，每个异常广告组每天新增一条待批准，不会自己清。因此**在关掉 `autopilot_dry_run` 之前，必须先设计过期或合并机制**；本 PR 不碰，但写进上线前置条件。
- **④ 绕过审批层的写 Meta 路径，③ 管不到**：`meta-ads/execute/route.ts:181-182`（暂停系列直接 `setCampaignStatus`）、`google-ads/execute`、草稿上线（`draft-and-gate.ts`）都走自己那套。PM 10-10 的「开新广告只认 PM 本人」靠 ③ 覆盖不全，需另开卡逐条收口，不在本设计内。
- **回滚**：把 `AUTO_APPROVE_ALLOWED_KEYS` 设为全部 ads 键并推进 `MAPPING_EFFECTIVE_AT`（或还原 PR 后推进）；同样会作废在途待批准；O1 又回到被拒状态。
- **不要用「CTS 切回 observe」当零代码止血**：`observe` 会让止损/降预算也变成待批准，而它们批完没人执行，急刹车失效。
- 级别 A（授权语义）。PR 保持草稿，正文写「风险级别：A」，PM 回「合 N」才合；合并后立即有效，不另需重同步。

## 补一行行动记录（手建的 4 个草稿壳子）

- `flywheel_actions` 一行：flywheel=ads、**vendor=`meta`**（与现有写入一致）、action_type=`meta_draft_shell_created`、payload 含 request id（本轮 Meta 调用的 client_conversation_id）、client_id、ad_account_id=act_2202695063810470、四个对象 ID、status=DRAFT、no_publish=true、created_by=74号；**不设 `expected_metric`**（草稿不评估，也不进评估）。
- 写生产库，按规矩要 PM 点头；PM 回「记」我才写；不建新表。

## Reuse Statement

- 复用：作战地图的账户读取与文案、`ad_snapshot_captures`、`getClientAdAccounts`、`accountStatusAsOf`、`ads-circuit-items` 的待办写法、`computeVerdict`/`computeOutcomeVerdict`、`isUnexecutedSuggestion`、`autonomy/sync-policy.ts`；Kernel 原样。
- 平台共享：账户状态待办（任何 Meta 客户）、极性表（任何客户任何行业）、按键策略映射。无客户名/ID 进共享代码。
- 行业/客户特定：无；CTS 只出现在证据里。
