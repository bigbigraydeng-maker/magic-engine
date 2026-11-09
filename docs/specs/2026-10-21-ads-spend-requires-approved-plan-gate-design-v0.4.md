# 「没有已批准的推广计划不许开投」· 设计 v0.4（定稿小修）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 v0.1–v0.3 之上：冲突处以本稿为准。吸收魏征/子牙对 v0.2 的补审。风险级 A。

## 1. 闸的作用范围（写死）
- 只作用于：`new_spend`、`budget_change` 且 `after > before`、一切把实体变成 ACTIVE/ENABLED 的动作。
- **一律不过此闸**：`pause`、`creative_only`、减预算（`budget_change` 且 `after ≤ before`）、全部 `HUMAN_STOP_ACTION_KEYS`（人工止损信封不套计划闸）。核对并在清单里逐个标注 `meta-ads/execute` 的 `ads.pause_campaign`、`ads.adjust_bid` 降预算（`route.ts:183`、`:213-226`）。
- 反向测试：无计划/读库失败/计划到期时，`pause`、`cut_*`、减预算、PAUSED 写入必须放行。
- `adFitsApprovedPlan` **只管「启用」与「加预算」**，不得用于暂停/减预算；已在投的旧广告不被新规则动（只出可见性待办）。

## 2. fail-closed 方向（改写 v0.1 §5）
**fail-closed 只用于「增加花费」方向；停止方向 fail-open。** 读 `marketing_plans` 超时/失败时：加钱、启用被拦；D3 自动暂停与 PM 紧急暂停**不得被拦**。计划闸做成 `EnvelopeFacts` 里的一项事实 `planCovers`，并入现有「读不到先拒」，**不在 `authorize.ts` 另写**；只被加钱类 kind 引用。

## 3. 「撤回」与「手动重新启用」分开
- **撤回**（回滚）：只放行「在 N 小时内恢复到同一回执里记录的暂停前状态」；超出时限或状态不一致 → 当作手动重新启用处理。
- **手动重新启用**（`ads.reactivate_campaign`；`AdsAuditSection.tsx:78` 同一 action）：**必须过计划闸**。
- 三处 ACTIVE 写入各自声明：`stop-loss.ts:224`、`ads-auto-pause/index.ts:167`、`pause-unit.ts:58` —— 写 PAUSED 的豁免，写 ACTIVE 的（回滚路径）按撤回规则，其余过闸。

## 4. 「覆盖今天」唯一定义（作废 v0.1 §1 旧口径）
覆盖 = 现役 `approved` 且 `plan_data.promo` 解析成功的某计划里，**今天（固定 `Pacific/Auckland` 转 `YYYY-MM-DD` 字符串比较）落在某阶段内、该阶段含 `ads_campaign` 步骤、且不在该步骤 `paused_ranges` 内**。`marketing_plans.start_date/end_date` 为 NULL 一律按不覆盖，以阶段日期为准。多行 approved 取并集；被退回草稿的行**立即不计入**。边界日测试：NZ vs AEST 时区差、夏令时切换日、跨午夜。时区后续取客户/账户时区（实现设计里定）。

## 5. 步骤归属与预算口径
- **归属先读 `DraftRecord` 看能否加 `plan_id + step_id` 字段**（`ad_creative_links` 不适合放步骤归属）；未核实前不下"未归属一律拦"的结论。
- **一次性回填优先**：上线当天 10/20 已开投的广告全部"未归属"。第一步是回填归属（来源：草稿 `promo-draft-facts`）；**回填完成前，对老广告只出待办，不拦**。
- 步骤级预算合计若算不出，降级为「账户级合计 ≤ 该账户所有进行中步骤预算之和」；读不到则拦（加钱方向）。
- 同账户两个步骤并行时预算归属：按广告所挂步骤分别累计，各自 ≤ 步骤预算；挂不上任何步骤的算"未归属"（同上，回填前只出待办）。
- 素材换新版本但 alias 未登记：不匹配 → 拦并提示"先在素材池登记别名"。
- 受众：`audience_ref` 硬匹配；`placements` 因 Meta 自动优化只告警不拦（实现设计里逐项确认）。

## 6. 内容指纹（避免改无关文案就集体拦）
指纹只对 `ads_campaign` 步骤相关字段（账户、日预算、受众、素材、placements、paused_ranges、阶段/步骤日期）计算；或"重新核对"自动执行（吻合则刷新 hash）。改社媒文案、标题等无关字段不触发拦。

## 7. 手工建广告（改称"事后发现"）
- 一层真闸（ME 内部所有入口，见 v0.3 §3 + 补充：`winner-reel-sync/engine.ts:277 createAdFromPost`、`ad-publisher.ts:364 activatePublished`、`ad-health/o1-scale/route.ts` 增预算、Google/TikTok 入口，与 2999 一起补登记）。
- 事后发现：每日扫描，**最大窗口约 24 小时**（含快照读失败时升级为"读不到"待办）；扫描不只扫"无计划"，也扫"有计划但超出步骤"；MCP/Meta 后台手建只靠每日扫描。
- 待办写明：谁看（CTS 广告总控 + PM 待办）、几点前（当日 NZ 上午）、升级路径（超过 2 天未处理升级给 PM，按天升级）。到期前 7 天提前提醒。

## 8. 上线与验收
- 上线：只读盘点（按客户列"在投但无覆盖计划"，含 NAL）→ 给 PM 看 → 先 warn 一周 → 再 block；老广告回填归属前不拦。
- UI：「批准计划」按钮旁写「批准计划≠能开投」；批计划动作本身不受闸约束。
- 验收含 §1 反向测试、§2 读库失败仍放行停降、§4 边界日、§5 回填前不拦老广告、§6 改无关文案不集体拦。
