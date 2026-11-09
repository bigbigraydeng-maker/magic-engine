# 「没有已批准的推广计划不许开投」· 设计 v0.3（增量稿）· 只设计，未写代码 · 119 号 · 2026-10-21

> 在 v0.1 + v0.2 之上：冲突处以本稿为准。吸收子牙+魏征对 v0.1 的审查。风险级 A。

## 1. 闸只管"花钱变多"，绝不拦"停/降"（最重，魏征反向事故）
计划闸**只**管：新开投、加预算（含 `budget_move_plan` 里的加预算部分——倾向拦，实现设计里明确）、把任何实体写成 ACTIVE。
**明文豁免、任何情况下不被计划闸拦**：`pause`、`cut_*`、降预算、`PAUSED` 写入、`creative_only` 换素材、撤回回滚。理由：计划到期 + 转化崩时，D3 暂停若被"读不到计划→先拒"拦住，会继续烧钱。
- 现有 `autonomy-envelope.ts` 的"读不到先拒"对所有 kind 一视同仁——计划闸**不**放进 `isWithinEnvelope` 直接查库；做成 `EnvelopeFacts` 里的一项事实 `planCovers`（读不到 = `unreadable`），只被 new_spend/加预算/ACTIVE 类 kind 的判定引用，pause/cut/降预算类不引用。实现设计里点明走哪套信封（AI 信封 vs human_stop 信封）。
- 加测试：计划缺失、读库失败、计划已到期时，停/降/PAUSED 写入**仍放行**。

## 2. 「覆盖今天」完整定义（一个函数，全仓唯一）
- 取现役 `marketing_plans.status='approved'` 且 `plan_data.promo` 解析成功（`parsePromoSpec` ok）的行（**任一已批计划覆盖即算，取并集**；v0.1 §5「冲突一律拦」作废，只在"读不到/解析失败"时 fail-closed）。
- 覆盖 = **今天落在某阶段内（复用 `phaseOnDate`，`spec.ts:281`）且该阶段含 `ads_campaign` 步骤**——不用计划整体起止（会把 12/21–1/14 这类停投空档算进去）。`marketing_plans.start_date/end_date` 可空/可 null，一律以 `plan_data.promo` 阶段日期为准；阶段空档、未来起始的已批计划、end 为 null 的已批计划都按各自阶段判断（end 为 null 不误拦：由阶段日期决定）。
- 「今天」= `Pacific/Auckland`（后续取客户配置时区）转 `YYYY-MM-DD`，与 `nzToday` **同一个函数**；加跨夏令时切换日、跨午夜测试。
- `war-map/load.ts:327 loadPlan`（取 draft/approved 最近更新一行）与本闸口径不同：统一成同一个函数（实现时改 loadPlan 复用，或明确它只用于展示、不放行）。
- `plan_data.promo` 是否唯一判据：实现前必须读 `gates.ts`/`spec.ts` 核实，不在设计里假设。纯函数测试覆盖五种：阶段空档 / start 为空 / 未来起始 / 跨时区午夜 / 读取失败。

## 3. 入口清单（补全；每个调用点标「过计划闸 / 豁免」）
| 入口 | 标记 |
|---|---|
| `approveDraft` → `activatePublished`（三层激活） | 过计划闸 + 日预算闸（2999） |
| `ads.reactivate_campaign`、Google `google-ads/execute` 的 `setCampaignStatus ENABLED`、TikTok `tiktok-ads/execute` 的 `reactivate_campaign` | 过计划闸（与 2999 一起补登记） |
| 内核 `scale_unit_budget`、`add_retargeting_adset`、`budget_move_plan` 的加预算部分 | 过（经 `EnvelopeFacts.planCovers`） |
| `ads.adjust_bid`（`execute/route.ts:197-215` 现只准降） | 降=豁免；**若以后放开上调，必须同时过计划闸**（架构测试断言上调路径存在即要求登记） |
| winner-reel-sync `createAdFromPost` 的 `newAdDefaultStatus`（可配 ACTIVE，`engine.ts:277-283`） | 过：配置为 ACTIVE 时自动建就开，必须过计划闸；建议默认只允许 PAUSED |
| `setAdSetStatus`/`setCampaignStatus` 写 ACTIVE 的调用方（`adsets.ts:147`、`campaign-writes.ts:38`；stop-loss 路由、`stop-loss.ts:224`、ads-auto-pause、pause-unit） | 写 ACTIVE 的过计划闸；写 PAUSED 的豁免；rollback 回写 ACTIVE 不拦、只报警（同 2999） |
实现设计第一步：grep 全仓所有能写 Meta/Google/TikTok ACTIVE/ENABLED 或预算的底层方法，补成一张"现状清单"（带文件行号），架构测试范围收窄为「放行花钱的判断」+ 白名单。

## 4. 并发竞态
`approveDraft`（`draft-and-gate.ts:396-470`）闸通过后若计划被退回/改内容，`activatePublished` 三层照开 → **在「占位成功后、第一次 Meta 写之前」再读一次计划状态**；回执记 `plan_id` + `plan updated_at` + 内容指纹。批准后改内容是否使旧广告失效：对齐 `plan-guard` 的锁定字段（改内容必须先退回草稿，故以内容指纹变化为准，见 v0.2 §2）。

## 5. 手工建广告：一层真闸 + 两层事后提醒（改口径，如实写）
- 真闸只有一层：ME 内部所有入口（§3）。
- 事后提醒两层：每日扫描"无覆盖计划却在投/超出步骤" → 红色待办；回报 ad_id 入口（**登记，不是闸**）。
- **如实写**：在 Meta 后台/MCP 手工建并启用的广告 ME 拦不住；对已在投广告本规则**只提供可见性**；快照刷新频率与覆盖账户未在此承诺——最坏发现延迟照搬 2999 的延迟免责（约 31 小时窗口）；快照读失败须出「读不到」待办，不得静默当没问题；红色待办要有升级路径（超过 N 天未处理升级给 PM）。

## 6. 范围与上线
- 默认对所有由 ME 开投的客户**强制**（做成客户配置项 `require_approved_plan`，默认 true，关闭需 PM 书面同意）；"没有推广计划记录的老客户同样拦"= 拦**新开投与加预算与 ACTIVE 激活**（不含停/降）。验收逐条列。
- **上线顺序（必改）**：①先跑只读盘点：列出"有在投广告但无已批覆盖今天计划"的客户名单（含 NAL 等），给 PM 看；②先 **warn** 模式（只出回执/待办不拦）观察一周；③再 **block**。
- **「批计划」是唯一出口**：批计划动作本身不受本闸约束；批计划与能开投是两道独立闸（v0.2 §3）。
- 回执落 `flywheel_actions`/授权回执，验证 PM 待办可见。2999 目前无代码，写明实现顺序：2990 → 2999（含计划闸一项）→ 计划闸 warn → block。
- 不指向任何不在主干/本分支的文件（`ad-agent-system-v1-architecture.md` 不引用）。

## 7. verify_how（含反向验收）
①无计划/读库失败时：approveDraft、reactivate、加预算被拦并写回执；②**无计划/读库失败时：pause、降预算、PAUSED 写入仍放行**；③end_date 为 null 的已批计划不误拦；④停投空档日启用被拦；⑤退回草稿后留底记录存在但不放行；⑥批计划动作不被闸拦。
