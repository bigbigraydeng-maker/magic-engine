# 「没有已批准的推广计划不许开投」· 设计 v0.6（定稿小修）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 v0.1–v0.5 之上：冲突处以本稿为准。吸收魏征/子牙对 v0.4 的最终核对。风险级 A。

## 1. 「读不到」只对加钱方向生效，且放在按动作类型分流之后（改写 v0.4 §2）
`autonomy-envelope.ts`（约 101–135 行）的「读不到先拒」对所有动作一律在分流之前生效。**计划闸不并入那一段。** 写法：仿现有 `isIncreasing` 的写法，`planCovers` 为 `null`（读不到）→ 拒，**这件事只对 `new_spend`、增预算的 `budget_change`（改后账户合计 > 改前）、写 ACTIVE/ENABLED 成立**，放在按动作类型分流**之后**。`pause`、`creative_only`、减预算、全部 `HUMAN_STOP_ACTION_KEYS` 永远不进这段。
反向单测：读 `marketing_plans` 超时/失败/无计划时，AI 信封里的 `pause` 与减预算**仍放行**。

## 2. 日期列不参与判断（统一 v0.3/v0.4 的矛盾）
`marketing_plans.start_date/end_date` 列**完全不参与**「覆盖今天」判断，只看 `plan_data.promo` 的阶段日期与步骤日期。改写 v0.3 §7③ 为：「`plan_data.promo` 阶段结束日在未来的已批计划不误拦；列为 NULL/过期不影响判断」。（作废 v0.4 §4 里「起止为 NULL 一律不覆盖」的措辞——NULL 的列根本不被读。）

## 3. `budget_move_plan`（先减后加）
闸在**第一步执行前整体判一次**：用「整个挪动后各账户/步骤的日预算合计」判断。总额不变或变少的挪动（净增加 ≤ 0）视为减类，**豁免**；净增加 > 0 的整体进计划闸，不通过则**整个动作不开始**，不允许先降成功、后一步被拦造成半截动作。

## 4. `approveDraft` 占位后复核失败的善后
「占位成功后、第一次 Meta 写前」再读计划状态（v0.3 §4）失败或不再覆盖时：把草案状态**回退到 `awaiting_approval`**（释放占位）并写回执（原因、`plan_id`、`updated_at`），不得停在 `activating`。加测试：占位后计划被退回草稿 → 草案回到 awaiting_approval，回执可见。

## 5. 存量广告处置（作废 v0.1 §7「对 CTS 无新阻挡」）
**v0.1 §1「覆盖今天=计划整体起止」与 §7「CTS v5 对它无新阻挡」均作废。** 如实写：回填归属后，CTS 现有广告按 `adFitsApprovedPlan` 仍可能超出计划（例：10/20 实际日预算 140 vs 计划 101）；**之后任何对这些广告的重新启用/加预算会被拦**。处理方式只有两种：改广告使其落进计划范围，或把计划退回草稿、修改后再批。已在投的不被动，只出可见性待办。

## 6. 受众硬匹配先只告警
`audience_ref` 与实际受众池的对应关系**未核实**：核实前受众不匹配只告警（黄色待办），不硬拦（与 v0.5 §3 一致）；核实后才启用为硬闸（单独决定）。

## 7. 时间与最坏发现延迟（统一口径）
- **「今天」用同一个函数**：仓库里已有 7 处同名 `nzToday`（`promo-window.ts:65`、`pm-todo/ledger-items.ts:21`、`crm/booking-view.ts`、`calendar-closure/run-audit.ts`、`campaign-daily-plan/.../authorize/route.ts` 等）。计划闸**只用 `src/lib/ads-strategy/promo-window.ts` 的 `nzToday(nowMs)`**，并在实现时把它抽成 `src/lib/` 下共用模块、其余同名函数改为委托（单独一块，不并入本规则）。固定 `Pacific/Auckland`，后续取客户/账户时区时一次定死。
- **最坏发现延迟统一为约 31 小时**：每日扫描周期 24 小时 + 快照刷新滞后最多约 7 小时（依据：`promo-plan-daily-watch` 的 cron 为 `10 7 * * *`，**时区按 Render cron 解释待核实**；快照刷新频率沿用 2999 的口径）。v0.4 §7 的「约 24 小时」改为「约 31 小时（以 2999 延迟免责为准）」。
- 撤回恢复窗口 N：初定 **2 小时**，由 PM/广告总控定（谁定：广告总控提议、PM 本人确认），实现设计里写进配置，不写死在代码里。

## 8. `loadPlan`（`war-map/load.ts:327`）
它取 draft/approved 最近更新的 10 行里第一份可解析的 promo——是**展示用**口径，与闸「任一已批覆盖今天取并集」不同。**闸不使用 `loadPlan`**；闸用独立的纯函数读现役 approved 行。展示用的 `loadPlan` 保持原样，并在其注释写明"不得用于放行花钱"，架构测试断言放行花钱的判断不引用它。

## 9. 实现前第一步（未核实项集中列出，按顺序）
①`plan_data.promo` 是否唯一判据；②步骤级预算合计能否算（CBO vs ABO 累计口径）及降级方案；③`audience_ref` 与实际受众池对应；④`DraftRecord` 能否加 `plan_id+step_id`；⑤`promo-plan-daily-watch` cron 时区与快照刷新频率；⑥全仓能写 ACTIVE/预算的底层方法现状清单（带行号）。

## 10. 台账卡
`docs/ledger/2026-10-21-ads-spend-requires-approved-plan-gate-design.md` 的 `verify_how` 更新为引用 v0.4 §8 + v0.6 §1、§3、§4 的验收（含反向测试）。
