# 证据：两个广告口子核实（2026-10-06，只读）

只读核实，没改代码、没改生产库、没动广告账户。生产库 = CrazyContent 项目（只读查询）。
行号基于 2026-10-06 工作区（HEAD 358e4a3da）。

## 口子一：开广告只验登录 —— 部分属实（风险级建议 A）

「只验登录」说得不准：实际验的是「登录 + 是这个客户的付费档账号 + 广告系列确实属于这个客户的广告户」。
属实的是：**没有 PM 授权事件、没有预算上限检查、没有熔断检查、没有留给 Kernel（审批内核）的回执**。

把 Meta 广告切成 ACTIVE 的入口，逐个 grep 调用点：

| 入口 | 验了什么 | 缺什么 |
|---|---|---|
| `POST /api/clients/[id]/meta-ads/execute`，`action_type=ads.reactivate_campaign`（[route.ts:160](src/app/api/clients/[id]/meta-ads/execute/route.ts:160)，鉴权 :64 → `requirePaidClientAccess`，[client-access.ts:135](src/lib/auth/client-access.ts:135)） | 登录；该客户付费档账号（admin / both / dashboard / client / fde）；系列属于该客户的广告户（AD-SEC-1）；不是私信广告草案（:112-131，查不出也拒） | 不走 Kernel；不查日预算上限；不查熔断；不要 PM 授权；谁点的只落一条 flywheel_actions，没有「批准」这一步 |
| `POST /api/ad-approval/[actionId]` approve（[route.ts:62-70](src/app/api/ad-approval/[actionId]/route.ts:62) → `approveDraft` → `activatePublished`，[draft-and-gate.ts:411](src/lib/ads-strategy/draft-and-gate.ts:411)） | 登录；该草案所属客户的付费档账号；草案状态必须是 awaiting_approval；类型白名单 | 「点头的人是不是 PM」没验——该客户任一付费账号都能点；不走 Kernel；不查日预算上限；不查熔断 |
| Kernel 回滚（`ads-auto-pause` 的 rollback、`pause-unit` 的恢复） | 走 Kernel，只在自己先暂停过的前提下恢复 | —（这条是对的） |
| `winner-reel-sync` 新建广告（[engine.ts:283](src/lib/winner-reel-sync/engine.ts:283)） | 服务端定时任务；状态取配置，列默认 `PAUSED`（迁移 20260711 第 27 行） | 谁把配置改成 `ACTIVE` 没有闸——要查各客户当前值（本轮未查） |
| `boostPagePost`（[boost.ts:52](src/lib/meta/boost.ts:52) 建的就是 ACTIVE） | 无调用方，只被重新导出（[client.ts:57](src/lib/meta/client.ts:57)）；`/meta-ads/boost-post` 路由已退役返回 410 | 死代码，建议顺手删，别留着被人接上 |

**最坏情形**：该客户的任意一个付费账号（生产库里有此类账号：6 个 both、2 个 dashboard、1 个 client，分布在有广告户的客户上；不含 self_serve）
发一条 `POST /meta-ads/execute {action_type:"ads.reactivate_campaign", campaign_id:<自己广告户里一条已暂停的系列>}`，
就能把被熔断/自动止损暂停的系列重新开起来，原来的预算照花，**绕过日预算上限和熔断**（这两样只在 Kernel 里生效，这条路不进 Kernel）。
限制：只改系列这一层；系列下的广告组/广告若仍暂停则不花钱——被「暂停系列」止损的那种（只停了系列）会直接恢复花钱。
跨客户不行（有归属校验）；同一广告户被两个客户共用时挡不住（代码注释已承认）。

生产里的实际使用：flywheel_actions 里 `ads.reactivate_campaign` 近期 0 条、`ads.create_ad` 0 条，所以这是「口子在、没人走过」，不是已出事。

**建议怎么修（本轮没动手）**：
1. `ads.reactivate_campaign` 不再直连 Meta：改成进 Kernel 提交，走授权事件 + 账户日上限 + 熔断；或先临时限定只有 admin 能用。
2. ad-approval 的 approve 要求 PM 身份（admin/scoped_admin），或在 approve 前插一个 PM 授权事件并写回执，fail-closed。
3. 删 `boostPagePost` 死代码。
4. 查各客户 `winner_reel_sync_config.new_ad_default_status` 当前值。

## 口子二：生产库缺「账户日预算上限」列 —— 属实；「暂停被拒」部分属实（风险级建议 A）

证据：
- 生产库 `client_meta_ad_accounts` 实查只有 7 列：id / client_id / ad_account_id / label / is_primary / created_at / updated_at，**没有 daily_budget_cap_cents**。
- 9-27 那份加列迁移（`supabase/migrations/` 下 9-27 的 `…_client_meta_ad_accounts_daily_cap.sql`，文件头写明「只随 PR、不在 PR 内 apply，需 PM 授权」）**不在**生产迁移记录里（记录里 9-27 只有 meta_data_deletion_requests / meta_ads_ai_self_serve / ads_circuit_events_v2 / whatsapp_phone_number_id）。
- 读这一列的代码：[envelope-facts.ts:109-113](src/lib/capabilities/ads/envelope-facts.ts:109)（仅加预算时用）、[envelope-facts.ts:572-575](src/lib/capabilities/ads/envelope-facts.ts:572)（**所有广告动作都走**，含暂停）、[daily-cap/route.ts:112](src/app/api/clients/[id]/ad-accounts/[accountId]/daily-cap/route.ts:112)（PM 设上限的接口）、[autonomy-settings.tsx](src/app/dashboard/clients/[id]/ads-health/autonomy-settings.tsx:28)（设置面板）。
- 失败时：全部**拒绝（fail-closed）**，没有一处放行。envelope-facts 读不到→`cantRead`→Kernel 在 [authorize.ts:420-428](src/lib/kernel/authorize.ts:420) 以 `outside_autonomy_envelope` 拒绝；PM 设上限的接口和面板也会读失败。

「暂停被拒」逐路径推演（只读代码，未触发任何真实动作）：
- 经 Kernel 的暂停/降预算（`/ad-health/stop-loss` 按钮 → `submitStopLossThroughKernel`，[stop-loss.ts:23-50](src/lib/action-submission/stop-loss.ts:23)）：**会被拒**。解析器在判人工信封之前就读这一列（:572 无「暂停可跳过」分支），人按的也一样。
- 经 `meta-ads/execute` 的 `ads.pause_campaign`（[route.ts:157](src/app/api/clients/[id]/meta-ads/execute/route.ts:157)）：**不受影响**，它直连 Meta，不进 Kernel——所以 PM 还能通过这个入口停广告，但这条路也同样没有 Kernel 的任何保护。
- 加预算（O1 scale）：被拒（loadClientBudgetRollup 读失败返回 unavailable）。
- 即使以后把列加上：CTS 绑了 2 个广告户，在 PM 给每个户填上限之前，Kernel 路径仍然会因 `facts:账户级日上限未配置` 拒绝（envelope-facts.ts:585-587）。所以「加列」不够，还要「填值」，这一步是 PM 的业务决定（迁移头注释已写：CTS 主账户 100 / 另一个 50，客户级 150）。其余 4 个单账户客户回落到客户级总闸，不受影响。

实际影响：生产库 `action_runs` 里 `ads.*` 的运行记录**历史上 0 条**（全部时间查询），说明 Kernel 广告路径在生产**从没跑过**——没有因此拒掉过任何真实操作，也没有成功过。这是「配置没就位、功能还没开张」，不是事故。

**建议怎么修（本轮没动手，需 PM 授权，属改生产数据库 = A 级）**：
1. PM 授权后 apply 这份加列迁移（只加列不填值，可重复执行，安全）。
2. PM 在绑定面板给 CTS 两个广告户各填上限（或明确说 CTS 先只走客户级总闸）。
3. apply 之后当场试跑一次人工止损链路（用不外发的方式），确认「暂停」不再被拒；再决定 Kernel 路径放开。
4. 顺手修规则：新增迁移文件但没 apply 的，PR 里要登记台账卡并设 `verify_by`，否则这类「文件在、库里没有」会再发生。

## 复用声明（Reuse Statement）
纯只读核实；未新增任何代码或能力。结论涉及的共享层：Kernel 信封事实解析器、`requirePaidClientAccess`。
客户特有内容（CTS 两个广告户的上限数值）只作为 PM 待填配置，不写进共享代码。
