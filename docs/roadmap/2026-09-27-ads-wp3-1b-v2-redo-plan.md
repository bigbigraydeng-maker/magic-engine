# 广告 WP3.1b v2 · 重做方案

**权威依据**：[`docs/specs/2026-09-25-ads-impact-wp3-design-v1.md`](../specs/2026-09-25-ads-impact-wp3-design-v1.md) v2.1（PM 2026-09-27 经小秘书窗口口头认，spec 状态已翻 `accepted`）。
**为什么重做**：上一轮 PR #2087 照的是**总纲 spec** [`2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md`](../specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md) §3 G11，跟本 3.1b 的权威 v2.1 严重对不上（11 条差距，见下表）。三方审（子牙 / 魏征 / 狄仁杰）也各自独立发现了 4 条 BLOCKER；上一轮的 55 个单测 + 10 处变异**全部在假件层**，一次都没打到真的会动钱的路径上。这次重做同时处理这两件事。

**分支**：`feat/ads-wp3-1b-v2`，从 `origin/main` = `48b8d030` 起。旧分支 `feat/ads-wp3-1b-circuit-breaker` 不删（Git 红线），PR #2087 保持草稿，新 PR 开出来后关掉 #2087 留话「已被本轮重做取代」。

**风险级**：**A**。碰 Kernel 权限表 / 授权路径 / 会动真广告花费的执行路径 / RLS。

**先出方案再动手**：PM 2026-09-27 经小秘书 `local_2bc4fba6-9a3f-426e-ac87-11458f9591d3` 明说「先出重做方案发我转 PM 看一眼，再让 DeepSeek 动」。本文件就是那份方案，PM 认之前不写一行代码。

**权威事实单（实现时逐条对照，别凭记忆）**：
`/private/tmp/claude-501/-Users-raydeng-Projects-magic-engine--claude-worktrees-priceless-wilbur-973355/bb3d4403-44fa-49a6-9510-5dcdf5e7d3a0/scratchpad/wp31b/SCHEMA-FACTS-v2.1.md`
统筹 2026-09-27 出，含 v2.1 §6 熔断 / §6.1 resolver 三件套 / §6.9 实施必带 / §3.9 账户级预算的原文抄录 + 生产库实测数据。上一份 `SCHEMA-FACTS.md` 作废。

**统筹 2026-09-27 已裁决两件事（本方案照着写，不再是"待 PM 判决"）**：
- **B4 走人工信封**（不走 kind 分派）：生产库实测——CTS + NAL 共 46 个广告组的 `learning_stage` **全部是 NULL**，`isWithinEnvelope` 第 ⑦ 条会拒掉每一个；kind 分派只解 ① 号阻断（`beforeCents=null`），剩 ②③④⑥⑦ 五条继续拒。见 §二 B4。
- ~~系列级旁路~~ **⚠️ 这一条现在是未决争议，不是裁决**：统筹说走 grandfather + ROADMAP 欠账（v2.1 §12 只点名止损一条路由）；PM 经小秘书 DR87-2 说三条旁路本轮全收编进 Kernel。**两版代价差一个量级，写代码前必须合口径 —— 详见 §零。**

**PM 待拍板 3 件（收到后再动）**：① 生产库那张错 schema `ads_circuit_events` 的 DROP 授权；② CTS 100/50 分别给哪个 `act_` 号（库里没有叫"个人账户"的行）；③ NAL 目标怎么写库（NAL 目前没有生效目标，验证时会 fail closed）。

---

## §零 · 范围已裁定（原争议已关闭）

**PM 2026-09-27 在统筹窗口亲口定：`三个一起`。** 三条绕过 Kernel 的旁路本轮一起收编，不留到下一轮。统筹原先那句「本轮不在范围」（引 v2.1 §12）**被 PM 的范围决定取代，作废**。

**spec 已同步升 v2.2**（`docs/specs/2026-09-25-ads-impact-wp3-design-v1.md`）：§0 的「不新增 ActionKey」与 §12 的 3.1b 旁路范围据此放宽，两处都就地标注了「已由 v2.2 放宽，见顶部」。
🔴 **为什么必须改 spec**：这一轮已经因为「实施跟权威稿对不上」翻车两次。第三次绝不能是「PM 口头改了范围，spec 还写着不许，下一个审查员照 spec 打回」。

### 架构那半从头到尾没变（再钉一遍）

**收编 = 提交 action_run 进 Kernel。「路由自 gating」（在路由里自己读熔断状态判断）永远不许排回来** —— 那是在 Kernel 之外造第二条授权路径（memory `feedback-status-field-as-authorization-leaks-gates` + ADR-001 只留一个入口）。PM 说的「收编进 Kernel」跟统筹否掉的「路由自 gating」是**对立的两件事**，PM 要的正是统筹要的。

### 三条旁路不是同一种东西（统筹查证）

| 旁路 | 触发 | 干什么 | 原挂闸状态 |
|---|---|---|---|
| `meta-ads/execute` | **人点** | 改系列状态 / 预算。卫青实证 9/21 七次里 **+48% / +100% 两次走 Kernel 会被 20% 上限拒** → 绕闸是已发生事实 | 未挂（有路由鉴权） |
| `meta-ads/boost-post` | **人点** | 花钱推帖 | 未挂（有路由鉴权） |
| **`winner-reel-sync`** | **每天 15:00 UTC cron 无人值守**（`render.yaml:341-347`） | **在 Meta 新建广告**（`engine.ts:14-19` `createAdFromPost`） | 🔴 **`@/lib/meta/ads-manager` 连 `GRANDFATHERED` 都没进** —— 全仓任何文件都能 import 它建广告 |

### 🔴 winner-reel-sync 的保护判据是「学习期」，不是「预算」

DR87-2 原话是「套上**预算保护**」。**照字面做会把真问题留在原地。** 统筹核过手册、我自己又逐条验了行号，四处都成立：

| 手册位置 | 原文要点 |
|---|---|
| `playbook-ads-meta-general` :249 | 「素材测试另建**新广告组**…别往正在跑的广告组里加新广告——Meta 把『广告组里新增广告』算重大改动，**会重置那个组的学习期**」 |
| :333 | 9/26 复盘教训 ③「疲劳处方是『同系列另建新组测新素材』，**不是往正在跑的组里加广告**」 |
| :367 | 「**另建独立系列**，别往再营销系列里加（往正在跑的系列里加会重置它的学习期）」 |
| :127–131 | 「每结果成本暴涨但点击率正常」**第一嫌疑人就是学习期被反复重置**；「学习期问题要做的恰恰是**什么都别改**」 |

**决定性的实例（:131 NAL）**：前 22 天 $470 收 24 个留资（$19.6/个）→ 后 7 天 $276 只收 2 个（**$138/个，7 倍恶化**）。素材一次没换，根因是 9 天里有 5 天有人在改它。
🔴 **花的钱是正常的，坏掉的是钱买到的结果 —— 任何预算上限都拦不住这种失败。** 卫青也查实 winner-reel-sync 累计只花了 $38.99、**从来没超支**。所以「预算保护」这个词本身指错了方向。

**收编判据写死（不接受「靠调用方自觉」）**：
1. `createAdFromPost` 的目标**必须是新建的独立广告组**
2. 往 `effective_status` 在投的既有组加广告 → **在 capability 层就拒**，不是在调用方那里劝
3. **变异测试**：把「另建独立组」改成「加进在投组」→ 必红
4. 预算保护仍然做（不超账户日上限 / 熔断期间不建 / 建了可撤回），但**不能只做预算**

### 层级门（统筹以 Inline 模式过，我不重跑，PR 描述引这段）

4 个新 ActionKey（系列级暂停 / 系列级砍预算 / 推帖 / 建广告）**全部挂在既有广告 L1 支柱下**：不新增能力线、不新增支柱、不新增 capability 域，**不进 `platform-candidates`**。红线逐条过：红线 1 —— 方向相反，是把执行手**收进**闸门，不是包装成智能层；红线 2 —— 判据全读 `ad_strategy_configs` / `client_meta_ad_accounts`，无客户名与行业硬编码；红线 4/5 —— 换客户 CTS→NAL、换行业旅游→物流，默认行为不变。
🔴 **每个新 ActionKey 的撤回处理函数必填**（K1）—— 少一个 `authorize.ts` 会直接拒，这条不许省。

## 一、11 条差距 · 逐条对齐 v2.1

|  # | 项 | 上一轮实现 | v2.1 要求 | 本轮怎么改 |
|----|----|----------|----------|----------|
| 1 | `ads_circuit_events` schema | `(client_id, occurred_on, trigger_code, outcome)` 每条判据一行、按客户 | `(client_id, ad_account_id, seq bigserial, kind ('trip'\|'release'), trip_event_id, sticky, reason, actor, evidence)` **按账户**，两条 CHECK：`ads_circuit_events_release_shape` + `ads_circuit_events_release_by_human`（v2.1 §11.3 + §6.9 第 3 条） | 生产库表 **DROP + CREATE**（差异太大，不 ALTER；那张表现在零数据、零调用方，删掉零影响）；新 migration 用 `20260927000002_ads_circuit_events_v2.sql`；顺序照 v2.1 §12 硬门原文：**migration 先 apply 再合并代码，PR 描述附 apply 回执** |
| 2 | 熔断状态 | 直接写 `ad_strategy_configs.autonomy_mode='observe'` | **不写** `ad_strategy_configs`，状态是**派生态**：存在任一 `kind='trip'` 且没有对应 `release` 且（`sticky` 或 `created_at > now()-24h`）→ 该 `(client_id, ad_account_id)` 处于熔断中（v2.1 §6.2） | 删掉 `circuit-breaker-apply.ts` 里的 `switchToObserve`；派生态查询写成 `isCircuitTripped(sb, clientId, adAccountId)` 纯 SQL |
| 3 | 落点 | 写 autonomy_mode → WP3.1a sync worker → Kernel policy | `createAdsEnvelopeFactsResolver` 检查派生态，处于熔断中返回 `unavailable('circuit:<reason>')` → Kernel authorize 层 deny (`outside_autonomy_envelope`) + pre_provider 层 `dead_letter+needs_human`（v2.1 §6.1） | 在 `envelope-facts.ts` 加熔断查询；`reason` 带机器可读前缀（`circuit:` / `facts:` / `manual_only:`） |
| 4 | 恢复 | 需要 PM 拨回 bounded_auto | 非 sticky **24h 自动过期**（没有 release 写入者）；sticky 由 admin 通过 `guardGlobalAdmin` 保护的 admin 解除接口写 `kind='release'`，`actor='human:<email>'`（v2.1 §6.4） | 新 admin 解除接口 `POST /api/admin/ads/circuit/release`；`actor` 从 `requireGlobalAdmin` 的 email 取，**不从 body 读**；一次解除该账户全部未解 sticky 但**逐条写 release**行（v2.1 §6.9 第 1 条） |
| 5 | 触发 #3 回滚失败 | 入参 `kernelRollbackFailures` | 韩信跑完 `runAction` 后**读 `action_run_steps`**、`step_key='rollback' AND status='failed'` → 立即写 sticky trip（`reason='rollback_failed:<run_id>'`）并中止本批剩余成员（v2.1 §6.3） | 韩信在 3.2 落地时接线；3.1b 只交付「判据函数」`detectRollbackFailure(runId, sb): 'trip' \| null`，配单测；等 3.2 里的批次 orchestrator 接线 |
| 6 | 触发 #4 Jev 低分 | 入参 `consecutiveJevLowScores` | 读 `prescription_evaluations`，按 `cycle_id` 分组连续 3 轮 `total_score<60` → sticky；另加「连续 3 轮 ≥50% reversed/inconclusive」（v2.1 §6.3） | **数据源不存在**（生产库实测 `prescription_evaluations` 不在 schema）。**打桩恒返回 `null`（undeterminable，不熔不放）是 v2.1 自己的既定分步安排，不是「缺东西凑合」**：v2.1 §9.3 标题原文「落库：新建表 `prescription_evaluations`」、§11.8 是这张表的 DDL、§12 分批表「WP3.3 Check + Tune + Jev + 日报两段」那行的内容列包含 §9 —— 所以这张表按 spec 就是 WP3.3 才建。欠账进 ROADMAP，3.3 表就绪后接线。**不自己建表**（v2.1 §0 明禁 + 超 3.1b 授权）。统筹 2026-09-27 已**撤回**原先「flag 给 PM 复审」那条，不必问 PM |
| 7 | 第 5 条数据不全 | 冻结当天 / 切档位分档 | **不存在这一条**；改成第 1 条「≥5 个非零花费天，否则 `undeterminable`（按 data-partial 处理，不熔不放）」（v2.1 §6.3） | 删掉「data_incomplete」概念；`detectSpendSpike` 判据加 sample-size gate |
| 8 | resolver 挂进生产 Kernel | ❌ 未做（只在自建 `ads-kernel-deps.ts` 挂了，生产 `createKernelDeps` 默认 deps 没转发；子牙 BLOCKER 1） | v2.1 §6.1 三大硬交付：`createKernelDeps` 转发 `resolveEnvelopeFacts`、`createKernel` 默认装 `createAdsEnvelopeFactsResolver`、架构测试断言「生产 Kernel 工厂产出的 `deps.resolveEnvelopeFacts` 非空」 | `src/lib/kernel/deps.ts:113-130` 的对象字面量加 `resolveEnvelopeFacts: init.resolveEnvelopeFacts` 一行；`src/lib/kernel/index.ts` 的 `createKernel` 默认装；`src/lib/kernel/__tests__/architecture.test.ts` 加断言 |
| 9 | 账户级日预算 + 面板 UI | ❌ 未做 | v2.1 §3.9 + §11.11：`client_meta_ad_accounts.daily_budget_cap_cents` 列；`envelope-facts.ts` 按账户取 `dailyCapCents`；多账户缺配置 → `unavailable('facts:账户级日上限未配置')`；PATCH 校验 `sum(账户上限) ≤ 客户总闸`；绑定面板 UI；CTS 主 100 / 个人 50 由 PM 在面板填 | migration 加列 `ADD COLUMN IF NOT EXISTS`；`envelope-facts.ts` 逐个动作按 `input.ad_account_id` 查该账户上限；`api/clients/[id]/ad-accounts/[accountId]` PATCH 路由加合计校验；`src/app/dashboard/clients/[id]/ad-accounts/page.tsx` 加输入 UI（简单表格，两列 name + cap） |
| 10 | WP2 遗留 [#1994] | ❌ 未做 | v2.1 §5.2 + §6.1 明说 3.1b 顺手修：`envelope-facts.ts:119` 解构里加 `at`，`at==='pre_provider'` 时读 `capture_reason='kernel_pre'` 快照；`limit(4000)` 窗口下 `hoursSinceLastRealChange` 误判 → 冷却期单独查询不受窗口限制 | 改两处；补测试 |
| 11 | 止损收编 | ✅ 做了 | ✅ v2.1 §12 表明说 3.1b 交付 | **代码大部分留**，但要跟 resolver-based 熔断 + 人工信封（见下方 B4）重接线；文件走一遍 review 消除跟错熔断残留的耦合 |

## 二、四条独立 BLOCKER（子牙 + 魏征 + 狄仁杰）

### B1（子牙）· Kernel 工厂漏一行，每条 run 必被拒
`src/lib/kernel/deps.ts:113-130` 的 `createKernelDeps` 对象字面量抄了九项，**没抄 `resolveEnvelopeFacts`**。所以我在自建 `ads-kernel-deps.ts` 里传了它、被工厂静默丢掉。六个 ActionKey 全 `mode: 'bounded'` → `authorize.ts:401` 无解析器一律拒。

**修**：跟 v2.1 §6.1 三硬交付合并成同一件事，见差距 #8。**架构断言必写**——子牙 grep 过，全仓现在一条都没有。

### B2（子牙 + 魏征）· 前端契约断了，成功报成失败、三件套被吞
`src/app/dashboard/clients/[id]/ads-health/page.tsx:362`：`if (!json.ok)` → 我新路由不返回 `ok` 字段，**happy path 直接掉进失败提示**。`:358` `if (!res.ok) throw` → 我新加的 409/503（`no_active_goal` / `campaign_level_budget` / `adsets_unreadable` / `nothing_active` / `goal_unreadable`）全被 `:375` catch 吞成同一句「这次没改成功」。三件套 `what/how/href` 一个字到不了 PM 眼前——**这是铁律 3 下半「发现不许死在日志里」的正面违反**。

**修**：
- 本 PR 内改 `page.tsx` 的 `run()`：按 `res.status` 分派——200 时读 `executed/awaiting_approval/refused` 三个数字分别说人话；409/503 把 `what/how/href` 渲染出来，`href` 做成可点链接；不再读 `ok/new_daily/warnings/not_cuttable`（路由不返回了）
- 同步更新 `page.test.tsx` 里那个 stub 契约；补一条 409 带三件套的用例
- `page.test.tsx` 断言 catch 分支不会把 200 吞成错误（专门加一处）

### B3（狄仁杰）· ~~熔断改意向表但 updated_at 不动 → sync worker 永远判 already_synced~~
**在重做后消失**：v2.1 不写 `ad_strategy_configs`，走 resolver 派生态；无 sync worker 参与。此 BLOCKER 随代码删除一起消。

### B4（魏征 + 统筹用生产库证实）· 人按的止损被 AI 自治信封拒掉 NAL 100% / CTS 52%

**这条是最贵的一条，也是唯一 v2.1 spec 没写但重做时不加就会翻船的**。

链条：
1. `stop-loss-submission.ts` 提交 `ads.pause_unit`
2. `registry-ads.ts` 六个 ActionKey 全 `approval: { mode: 'bounded', envelope: ADS_ENVELOPE }`
3. `authorize.ts:430` `mode==='bounded'` 就跑 `isWithinEnvelope`，**`triggeredBy:'human'` 不豁免**
4. `autonomy-envelope.ts:103` 先拒「读不到 `beforeCents`」
5. `envelope-facts.ts:229` → `daily_budget_minor=null` → `beforeCents=null`
6. CBO 广告组没自己的预算，`daily_budget_minor: null`

**生产库实测**：NAL 126 个广告组全 CBO（100% 停不下来）；CTS 514 个里 269 个 CBO（52%）。除 CBO 外，`excludeLearningPhase`（学习期未知按学习中拒）、`minHoursSinceLastChange:72`、`excludeAdStudies`（A/B 测试中拒）**对 AI 自动折腾对，对人按的止损全错**——止损只让花费变少，不伤学习期。

**修（统筹 2026-09-27 已裁：走人工信封，kind 分派否决）**：

生产库实测证据（统筹给出）：CTS + NAL 共 46 个广告组的 `learning_stage` **全部是 NULL**（46/46）。`isWithinEnvelope`（`autonomy-envelope.ts:103` 起）在 kind 分流**之前**有 **7 条**拒绝条件，`inLearningPhase(null)===true`（`:88`）会让第 ⑦ 条拒掉每一个。所以**只解 ① 号阻断（`beforeCents=null`）等于没动**，②③④⑥⑦ 五条继续拒。

**实现（不商量）**：
- `autonomy-envelope.ts` 新增独立常量 `HUMAN_STOP_ENVELOPE`（**不是**"把 AI 信封字段改成 false" —— 那样下次动 AI 默认值会顺手改人工信封）
- 内容：只保留三条判据 ——「撤回处理函数存在」+「归属校验通过」+「实体存在」；其余 ②③④⑥⑦ + 变动 ≤20% + 不超日上限 + 72h 冷却 **全部不适用**
- `isWithinEnvelope` 根据 `triggeredBy` + `actionKey` 分派：`triggeredBy==='human'` **且** action 是收类（`ads.pause_unit` / `ads.cut_unit_budget`）→ 走 `HUMAN_STOP_ENVELOPE`；其它一律走 `ADS_ENVELOPE`
- 放类（`scale` / `add_retargeting` / `swap_creative`）即使人触发也走 AI 信封——人手动加预算没有"只会变少"这个安全性
- `triggeredBy` **必须是服务端从授权上下文取**，不许从请求体读（同 v2.1 §6.4 对解除接口 `actor` 的要求：body 里给 actor 等于让调用方自报身份）
- **架构测试**：断言 `HUMAN_STOP_ENVELOPE` 不含 `excludeLearningPhase` / `minHoursSinceLastChange` / `maxBudgetDeltaRatio`；断言只有收类 ActionKey 能取到它
- **变异测试**：把 `triggeredBy` 改成从 body 读 → 必红；把人工信封开放给放类 → 必红

**顺带的好处**：人工信封不要求 `beforeCents`，CBO 从父系列取 `daily_budget` 那件事**不用做了**（原路 B 里最贵的一块直接省掉）。

### 魏征另外三条 BLOCKER

**B3（魏征命名）· 逐个暂停会漏实体、且系列留在 ACTIVE 等于伞没了**
- `adsets.ts:44` `limit:'50'`、`:64` `return json.data ?? []`——**没有翻页**
- 漏掉：51+ 广告组、后来被恢复的、新建的、系列本身没停
- `AdSetSummary.status` 是 4 个字面量，Meta 返回意料外值静默落到过滤外

**修**：`listAdSetsInCampaign` 走 `paging.next` 取完；只拿到一页且 `paging.next` 存在 → 返回 null 走 `adsets_unreadable` fail closed；暂停完**回读一次系列级**，断言"这个系列下没 ACTIVE 广告组"，否则报"停了 N 个，还有 M 个没停"（部分成功如实说）

**B4（魏征命名）· append-only 只是名字——生产库零触发器零规则**
本仓库范式：`supabase/migrations/20260808000003_me2_execution_kernel_v1.sql:209-212` `authorization_decisions_append_only()`。我抄的模板 `ads_autonomy_sync_receipts` 是**回执**表不是审计账本，性质不同。

**修**：新 migration 里就带上 `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` 触发器；架构测试断言表上有 append-only 触发器；等狄仁杰上来最终确认是否加 `REVOKE UPDATE, DELETE ... FROM service_role`（两道更狠）

**B5（魏征命名）· cycle_date 用裸 UTC 取日 → 幂等键失效 → 连按两次真的再砍**
`stop-loss/route.ts` 的 `new Date().toISOString().slice(0,10)`。`src/lib/ads-strategy/account-timezone.ts` 顶部注释写死「凡是要回答『昨天』的地方都必须走这里」。`cycle_date` 进 `registry-ads.idempotency.keyFields` → 新西兰跨 UTC 午夜的两次点击算出两个不同 `cycle_date` → 幂等键不同 → 第二次砍预算真的再砍一刀，20%+20%=36%。

**修**：`cycleDate = accountDayKey(账户时区, now)`；熔断器传 `evidence.cycleDate` 同样适用；补测试：mock now 到 UTC 午夜前后各一次、adAccount 时区 NZST → 断言算出**同一天**

## 三、变异测试盲区（这次交付真正的短板）

上一轮 10 处变异**全在假件层**，`runAction` 和 `submitStopLossThroughKernel` 都 mock 了、桩永远回 `succeeded`。所以「真信封会把 CBO 全拒」这个最贵的失败一次都抓不到。**变异集内部自洽，但边界正好切在钱前面**。

**本轮补三处真变异**（统筹 2026-09-27 明说 3 处，第 3 处是它加的，钉住 `learning_stage=NULL` 的生产真实形状）：

1. **CBO fixture + 人按暂停 → 拿到 `allow`**：`fake supabase` 里塞 CBO 形状 `ad_entity_snapshots`（`daily_budget_minor=null`），真 `isWithinEnvelope` + 真 `envelope-facts` + 真 `createKernelDeps`；提交 `ads.pause_unit` `triggeredBy:'human'`；断言 `authorization_decisions` 那行 `outcome='allow'`。**变异「人工信封的分派删掉」→ 必须变回 denied**——才是真的抓住。
2. **熔断状态派生态 + 提交 → 拿到 denied**：`ads_circuit_events` 里塞一条 `kind='trip'` 未 release 且 `created_at=now()-1h`；同上真链路提交；断言 `outcome='deny'` 且 `deny_code='outside_autonomy_envelope'`、`reason` 含 `circuit:`。变异「resolver 忽略 circuit 状态」→ 必须变回 allow。
3. **`learning_stage=NULL` fixture + 人按暂停 → 仍须 `allow`**（生产真实形状，46/46）：`ad_entity_snapshots.learning_stage=null`；提交 `ads.pause_unit` `triggeredBy:'human'`；断言 `outcome='allow'`。**变异「把 `excludeLearningPhase` 塞回人工信封」→ 必须变回 denied**——钉住"未来别人把 ⑦ 悄悄塞回人工信封"这个失败模式。

**变异范式照 v2.1 §14.1 原文（统筹 C4）**：仓里没有 stryker、也没有 `@inngest/test`，所以用 `scripts/kernel_mutations` 那套**手动变异脚本**范式，目录锁定 `src/lib/ads-strategy/autonomy/` + `src/lib/capabilities/ads/envelope-facts.ts`，**在冻结 head 上跑一次**（不是每次 commit 都跑）。上一轮我自己写的那个 `mutate.py` 临时脚本要换成这个范式。

**其它现有 10 处变异保留但重新对齐**（M2 M3 已经跟着删掉的第 5 条一起消失；M1 观察 vs deny 保留；M4 boundary 保留但要按违规文件清单比对不看退出码；M5-M10 移植到新代码）

## 四、v2.1 六条输入 · 交付点表

| 输入 | 交付点 | 谁写 |
|----|-------|-----|
| 1. **三条旁路收编进 Kernel**（PM `三个一起` 已定，spec 升 v2.2）。PM 硬约束：**`winner-reel-sync` 保留自动建广告功能，不停不删**；🔴 但保护判据是**学习期**不是预算（见 §零） | ① `src/lib/meta/campaign-writes.ts` 拆出 `setCampaignStatus`/`setCampaignDailyBudget`/`boostPagePost`，挂进 `PROVIDER_WRITE_MODULES`；② **新增三个 ActionKey**（`registry-ads.ts` + 三份新 capability handler `src/lib/capabilities/ads/`）：`ads.pause_campaign`（系列级暂停）、`ads.cut_campaign_budget`（系列级砍预算）、`ads.boost_page_post`（推广帖）；③ **`execute` 路由**改成按请求体动作提交对应 ActionKey —— 🔴 **卫青 DR87-2 实证这条口子真被用过**：9/21 那 7 次改动结果是救火有效，但走的正是不过 Kernel 的路，其中 **+48% / +100% 两次走 Kernel 会被 20% 上限拒**。所以「绕 20% 上限」不是理论风险、是已发生事实，收编优先级不变；④ **`boost-post` 路由**改成提交 `ads.boost_page_post`；⑤ **`winner-reel-sync`** —— PM 明说"走 Kernel 或至少读日上限+熔断"，本 PR 走**轻量方案**（不新建 `ads.create_reel_ad` capability，工作量太大）：sync 内部在真调 Meta 建广告前调 `envelope-facts.resolveCircuit(clientId, adAccountId)` 检查熔断 + 查 `daily_budget_cap_cents` 检查今天已花+计划新增是否超上限；命中 → fail closed + 三件套 + 打人工任务；这是"保留自动建广告 + 套上预算保护"两条都满足的最小实现，走 Kernel 收编留到 3.1c；🔴 **卫青 DR87-2 回查加的第三条约束：还要让它「新建独立广告组」而不是塞进在投组** —— 卫青查实它**没造成超支**（累计才 $38.99，因为它把广告加进已有组共享预算），**真问题是每次往在投组加广告会重置该组的 Meta 学习期**（最近一次 9/23）。所以这一条**不是预算问题、是学习期问题**，只加预算保护解决不了；收编时必须改成建独立组；⑥ ~~`PROVIDER_WRITE_GRANDFATHERED` 精确路径~~ 不需要了——三个路由都走 Kernel、winner-reel-sync 因 PM 授权的轻量方案单独走 envelope-facts 只读接口，不 import `campaign-writes` | 我自己写（A 级安全核心；新增 ActionKey 是 Kernel 权限表变更）；capability handler 部分可派 DeepSeek |
| 2. append-only 表触发器（三方定级 **CONCERN**，小秘书 2026-09-27 复核后更正；魏征 NOTE、狄仁杰+子牙 CONCERN；仍**本轮同 PR 加**） | 新 migration 建表就带 `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` 触发器，**模板从 `me_conversion_audit` 抄**（不是 `authorization_decisions_append_only()`）——理由：`me_conversion_audit` 那份带 `pg_trigger_depth()>1` 放行连带删除，狄仁杰沙盘验过 clients 级联 CASCADE 时可用。触发器跟 DROP+CREATE 进同一个迁移。PR 描述写明「这是对 v2.1 §6.2 DDL 的**增强**（v2.1 原文只写了 RLS 没写触发器），不是偏离」；架构测试断言表上有 append-only 触发器 | 我自己写（DB DDL 安全核心） |
| 3. 生产库那张错 schema `ads_circuit_events` 复用/迁移 | 新 migration **DROP + CREATE**：`DROP TABLE IF EXISTS public.ads_circuit_events`（旧的、零数据）；然后按 v2.1 §11.4 建新表 | 我自己写 |
| 4. 账户级日预算 + 面板 UI（CTS 主 100 / 个人 50）<br><br>⚠️ **跟卫青 DR87-2 第三条发现有重叠面，边界必须说清**：卫青挖出「**客户级日上限跨账户没生效** —— CTS 两个账户各花各的、合计 10 天超限」。小秘书 2026-09-27 明说这条**先不归我**，PM 在定要不要单独立项。<br>**重叠在哪**：我这一格做的是 ① 加账户级上限列 ② `envelope-facts` **按账户**取上限 ③ PATCH **配置时**校验 `sum(账户上限) ≤ 客户总闸`。<br>🔴 **我没做、也不该被假设覆盖的**：**运行时**的跨账户合计强制 —— 即「这个客户今天全部账户加起来花了多少、还能不能再动」。v2.1 §3.9 只说客户级是「总闸」，没规定 `envelope-facts` 在单账户动作时要去查**其它账户今天花了多少**。所以我这一格落地之后，**卫青那个洞仍然开着**，只是配置层多了一道 `sum ≤ 总闸` 的纸面约束。<br>**给 PM / 统筹的话**：别因为我做了 §3.9 就认为跨账户超限被修好了。要真修得在 `envelope-facts` 里加一次跨账户合计查询，那是卫青那条立项的活。 | ① migration `client_meta_ad_accounts.daily_budget_cap_cents` 列；② `envelope-facts.ts` 按账户取；③ `api/clients/[id]/ad-accounts/[id]/route.ts` PATCH 加合计校验；④ `dashboard/clients/[id]/ad-accounts/page.tsx` 加输入表格 | migration + envelope-facts 我写；PATCH 路由 + 面板 UI 派 DeepSeek |
| 5. WP2 遗留 [#1994] 顺手修 | `envelope-facts.ts:119` 解构加 `at`；`limit(4000)` 冷却单独查询 | 派 DeepSeek |
| 6. resolver 挂进生产 Kernel v2.1 §6.1 三硬交付 | `deps.ts` 一行、`createKernel` 默认装、架构断言 | 我自己写（Kernel 核心，`project-me2-deepseek-split-trial` 例外条款） |

## 四半、交付结构 · 三个叠着的 PR（统筹 2026-09-27 拍的技术决定）

**PM 定的是范围**（三条一起收编、不留下一轮），**不是「一个 PR」**。怎么切 PR 是技术决定，归统筹。

**为什么切**：上一轮翻车的直接原因就是东西多到审不过来、最要命的三处全漏了（55 个单测 + 10 处变异都测不到）。现在再塞 4 个 ActionKey + 3 份 handler + winner-reel-sync 的独立组逻辑，一个 PR 一定重演。

| PR | 内容 | 为什么这么切 |
|---|---|---|
| **A** | v2.1 §6 熔断全部（新表 + 派生态 + 五条判据 + admin 解除接口）+ resolver 生产挂载三件套 + **人工信封** + 止损收编 + WP2 遗留 #1994 两处 + 前端契约修（B2）+ 账户级日预算 + 面板 UI | 这就是原 3.1b，**自成闭环**，先落地先受保护 |
| **B** | 4 个新 ActionKey（`ads.pause_campaign` / `ads.cut_campaign_budget` / `ads.boost_page_post` / `ads.create_reel_ad`）+ 对应 capability handler + `registry-ads.ts` 注册 + 信封声明 + **撤回处理函数（K1 必填）** + `campaign-writes.ts` / `ads-manager` 挂闸 | **纯新增能力面**，不动 A 的判据，审查视角独立 |
| **C** | 三条旁路路由改成提交 Kernel（`execute` / `boost-post` / `winner-reel-sync` 含**独立广告组**逻辑）+ 退役 `executeStopLoss` | 依赖 B 的 ActionKey，最后落 |

**顺序 A → B → C。🔴 三个都合了才算 WP3.1b 完成** —— ROADMAP 里记成**一个工作包三段**，不许 C 掉队变成「下一轮」。

**每个 PR 的共同要求**：
- 保持**草稿** + 正文第一行 `风险级别：A` + **不合并等 PM**
- 各自过子牙 + 魏征；**C 必须加狄仁杰**（碰旁路收编 = 安全核心）
- A 的 migration 按 v2.1 §12 硬门**先 apply 再合并代码**，**apply 回执进 PR 描述**

**§五 的清单按这个归属读**：下面每一行末尾标了 `[A]` / `[B]` / `[C]`。

### B 的新增文件（原 §五 未列，本次补）

| 文件 | 内容 | 谁写 |
|---|---|---|
| `src/lib/kernel/registry-ads.ts`（改） | 注册 4 个新 ActionKey；各自 `outwardAuthorization`（含 `rollback: 'provider_native'`）、`idempotency.keyFields`、`costModel.stepCeilingUsd` 逐 step 给值、`allowedPurposes` | 我（Kernel 权限表 = A 级） |
| `src/lib/kernel/types.ts`（改） | 封闭 union 加 4 个 ActionKey 字面量 | 我 |
| `src/lib/capabilities/ads/pause-campaign.ts` | 系列级暂停 + **撤回处理函数**（改前状态写回） | DeepSeek + 我审 |
| `src/lib/capabilities/ads/cut-campaign-budget.ts` | 系列级砍预算 + **撤回处理函数**（改前预算写回） | DeepSeek + 我审 |
| `src/lib/capabilities/ads/boost-page-post.ts` | 推帖 + **撤回处理函数**（🔴 推帖花的钱撤不回，撤回 = 把推广停掉；这一条的 `reversible` 声明要跟 handler 行为一致，不许声明成能撤而实际撤不了） | 我（撤回语义要小心） |
| `src/lib/capabilities/ads/create-reel-ad.ts` | 建广告 + **撤回处理函数**（删/停新建的广告）+ 🔴 **独立广告组判据**（目标必须是新建组；往在投组加 → 在这一层拒） | 我（§零 那条学习期判据 = 本轮最容易被做错的地方） |
| `src/lib/meta/campaign-writes.ts` | 拆出 `setCampaignStatus` / `setCampaignDailyBudget` / `boostPagePost` | 我（A 级） |
| 4 份 capability 测试 + 1 份 registry 对齐测试 | 含「撤回处理函数存在」断言、`create-reel-ad` 的独立组变异 | DeepSeek |

### C 的改动文件（原 §五 未列，本次补）

| 文件 | 改什么 | 谁写 |
|---|---|---|
| `src/app/api/clients/[id]/meta-ads/execute/route.ts` | 按请求体动作提交 `ads.pause_campaign` / `ads.cut_campaign_budget`；**不再 import 任何 Meta 写函数** | 我（A 级） |
| `src/app/api/clients/[id]/meta-ads/boost-post/route.ts` | 提交 `ads.boost_page_post` | 我（A 级） |
| `src/lib/winner-reel-sync/engine.ts` | 改成提交 `ads.create_reel_ad`；**不再 import `createAdFromPost` / `pauseAd`** | 我（A 级 + 无人值守路径） |
| `src/lib/ads-strategy/stop-loss.ts` | 删 `executeStopLoss` + `StopLossDeps`，保留 4 个纯函数 | DeepSeek |
| 三条旁路各自的测试 | 含「熔断中提交 → 拿到 denied」、「`create_reel_ad` 目标是在投组 → 被拒」 | DeepSeek |

## 五、分文件改动清单（**PR A 部分**；B / C 的新增见上方 §四半）

### 新建（9）
| 文件 | 内容 | 谁写 |
|----|----|----|
| `supabase/migrations/20260927000002_ads_circuit_events_v2.sql` | DROP + CREATE 按 v2.1 §11.4 + append-only 触发器 + 显式 REVOKE/GRANT + 两条 CHECK | 我 |
| `supabase/migrations/20260927000003_client_meta_ad_accounts_daily_cap.sql` | 加 `daily_budget_cap_cents integer NULL` 列 | 我 |
| `src/lib/ads-strategy/circuit-state.ts` | `isCircuitTripped(sb, clientId, adAccountId): Promise<{ tripped: boolean; reason?: string; sticky?: boolean }>`；纯 SQL 派生态判定 | DeepSeek + 我审 |
| `src/lib/ads-strategy/__tests__/circuit-state.test.ts` | 覆盖 6 种状态：无行 / 有 trip 无 release / 有 trip 有 release / trip 过 24h / sticky 过 24h / 同秒并发多 trip | DeepSeek |
| `src/lib/meta/campaign-writes.ts` | 拆出系列级写函数 | 我（A 级） |
| `src/app/api/admin/ads/circuit/release/route.ts` | admin 解除接口，`guardGlobalAdmin` + email 从 auth 取（不从 body 读） | 我（A 级安全核心） |
| `src/app/api/admin/ads/circuit/release/__tests__/route.test.ts` | 覆盖：非 admin 拒、body 里 actor 被忽略、一次解除全部未解 sticky | DeepSeek |
| `src/app/api/clients/[id]/ad-accounts/[accountId]/daily-cap/route.ts` | PATCH 账户日预算上限 + 合计校验 | DeepSeek |
| `src/app/dashboard/clients/[id]/ad-accounts/page.tsx`（如已存在则加段） | 账户日预算表格输入 UI | DeepSeek |

### 改动（估 15+）
| 文件 | 改什么 | 谁 |
|----|-----|----|
| `src/lib/kernel/deps.ts` | `createKernelDeps` 对象字面量加 `resolveEnvelopeFacts: init.resolveEnvelopeFacts` 一行 | 我（一行，A 级安全核心） |
| `src/lib/kernel/index.ts` | `createKernel` 默认装 `createAdsEnvelopeFactsResolver` | 我 |
| `src/lib/kernel/autonomy-envelope.ts` | 加独立常量 **`HUMAN_STOP_ENVELOPE`**（名字全文统一用这个，统筹 C5）+ `isWithinEnvelope` 按 `triggeredBy` + `actionKey` 分派 | 我（A 级安全核心） |
| `src/lib/kernel/authorize.ts` | 传 `triggeredBy` 进 envelope 判定 | 我 |
| `src/lib/capabilities/ads/envelope-facts.ts` | ① 解构加 `at`；② `at==='pre_provider'` 读 `kernel_pre` 快照；③ `limit(4000)` 冷却单独查；④ 按账户取 `dailyCapCents`；⑤ 检查熔断派生态返回 `unavailable('circuit:<reason>')`；⑥ 🔴 **熔断查询自身报错时用区别于 `circuit:` 的前缀 `facts:circuit_query_failed` + 出一张 pm-todo（统筹 C2）**——v2.1 §6.2 说「读不到 / 解析失败 = 视为熔断中」，fail closed 方向对，但「真熔断了」和「查熔断这件事自己炸了」在下游长得一模一样；哪天这条 SQL 挂了，广告自治整个哑掉、PM 只看到一堆「熔断中」没人知道根因。正好接上已有的三前缀分派 | DeepSeek + 我细审 |
| `src/lib/meta/adsets.ts` | `listAdSetsInCampaign` 走 `paging.next` 翻页；只拿到一页且 next 存在 → 返回 null | DeepSeek |
| `src/lib/ads-strategy/stop-loss-submission.ts` → **`git mv` 到 `src/lib/ads-strategy/submission/stop-loss-submission.ts`** | 🔴 **必须搬家**：白名单收窄到 `src/lib/ads-strategy/submission/` 之后，文件留在 `ads-strategy/` 根下就不在允许目录里、架构测试直接红（统筹 2026-09-27 必改 2）。搬完 `grep -rn "stop-loss-submission"` 扫一遍改全部 import 点（已知至少 `ad-health/stop-loss/route.ts` 和它的测试）。同时改：`cycleDate` 走 `accountDayKey`；`triggeredBy:'human'` 显式传 | 我 |
| `src/app/api/clients/[id]/ad-health/stop-loss/route.ts` | 暂停完回读系列级、报"停了 N 停不了 M"；`cycleDate` 走账户时区 | 我 |
| `src/app/dashboard/clients/[id]/ads-health/page.tsx` | 前端契约修（B2）：按 status 分派、渲染三件套 | DeepSeek |
| `src/app/dashboard/clients/[id]/ads-health/__tests__/page.test.tsx` | stub 契约对齐 + 补 409 三件套用例 + 补 200 不被 catch 吞的用例 | DeepSeek |
| `src/lib/kernel/boundaries.ts`（旁路挂闸部分）| `PROVIDER_WRITE_MODULES` 加 `@/lib/meta/campaign-writes` + **`@/lib/meta/ads-manager`**（后者连 `GRANDFATHERED` 都没进过，全仓任何文件都能 import 它建广告 —— 本轮第一次盖住）。三条路由都收编进 Kernel，**所以不需要 grandfather 条目**。🔴 **不做「旁路自 gating」**（§零 已论证）| 我（A 级） |
| `src/lib/kernel/boundaries.ts` | ⚠️ **对 v2.1 §12 字面的一处偏离，必须在 PR 描述里显式声明（统筹 C1）**：§12 原文要求「`PROVIDER_WRITE_MODULES` 加 `@/lib/meta/adsets`」（整个模块），上一轮改成拆出 `adset-writes.ts` 只挂写的那一半 —— 理由是 `adsets.ts` 读写混在一起、整挂会误伤 7 个只读 importer，**子牙已核过 `adsets.ts` 全文并接受这个判断**。本轮沿用同一处理并同样声明。`PROVIDER_WRITE_MODULES` 加 `@/lib/meta/campaign-writes`；~~`PROVIDER_WRITE_GRANDFATHERED` 加两个旁路~~（**这一项归 §零 争议，解决后再定**）；`KERNEL_RUNNER_ALLOWED_CALLER_DIRS` 从 `src/lib/ads-strategy/` 收窄到 `src/lib/ads-strategy/submission/`（**配套必做 `git mv`，见上方 `stop-loss-submission.ts` 那行**）；改注释里那段假理由（点明 `action-submission/ads-auto-pause.ts` 已在承载 ads 域，boundary 判据是「不 import 域模块」不是「不认识域字符串」） | 我 |
| `.eslintrc.json` | 跟 `boundaries.ts` 同步 | 我 |
| **`docs/ROADMAP.md`** 🔴 **必改 3（统筹）** | 子牙 B3 的核心指控：CLAUDE.md §9.1 要求未完成任务回写 ROADMAP，上一轮一个字没改、ledger 卡还写着 done。**散文里提一句不等于排了工**，所以这次它进文件清单。本轮要回写这几条：① 系列级 / 自动化三条旁路真收编进 Kernel（需新 ActionKey + 一次 tier gate，视 §零 争议结果定是否留在本轮）② 熔断 #4 Jev 数据源等 WP3.3 `prescription_evaluations` 就绪后接线 ③ admin 看板页若延后到 3.1c ④ 其余本轮标 stub / 打桩 / 未接线的每一条 | 我 |
| `src/lib/kernel/__tests__/architecture.test.ts` | 加断言：生产 `createKernelDeps()` 产出 `.resolveEnvelopeFacts` 非空；append-only 表有触发器；`src/lib/ads-strategy/**` 之外禁 import `submitActionRun`；`ads_circuit_events` release 只能由过 `guardGlobalAdmin` 的路由写；变异测试 2 处见 §三 | 我 |
| `src/lib/pm-todo/ads-circuit-items.ts` | 判据改：`isCircuitTripped` 派生态；`reasonsOf` 按 `occurred_on = 最新那天` 全取（去掉 `.limit(5)`）；处理熔断中/dead_letter+needs_human 三种前缀分三种话（`circuit:` / `facts:` / `manual_only:`） | DeepSeek + 我审 |
| `src/lib/pm-todo/__tests__/ads-circuit-items.test.ts` | 假件按表 + 按过滤（`eq()` 推 `(col,val)` 进数组，用例断言过滤集合） | DeepSeek |
| `src/app/dashboard/admin/ads/circuit/page.tsx` | admin 看板 + 解除按钮（可选，先只有 API 也 OK；PM 通过 curl 也能解） | DeepSeek 或延后 3.1c |

### 删除
| 文件 / 段 | 为什么 |
|----|----|
| `src/lib/ads-strategy/circuit-breaker.ts`（本轮删旧）+ 单测 | 判定语义完全变了；重建成 `circuit-detectors.ts`（五条判据各一个纯函数）+ `circuit-state.ts`（派生态查询） |
| `src/lib/ads-strategy/circuit-breaker-apply.ts` + 单测 | 不写 autonomy_mode 了；派生态由 resolver 查 |
| `docs/ledger/2026-09-27-ads-circuit-breaker-observe-not-deny.md` | 卡内容作废 |
| `docs/ledger/2026-09-27-ads-circuit-events-append-only-table.md` | 卡内容作废（生产库表要 DROP + 重建） |
| `docs/ledger/2026-09-27-stop-loss-into-kernel.md` | 上一轮那张 `done` 卡作废；本轮新写一张 |
| **`executeStopLoss` + `StopLossDeps`**（不删纯函数）in `src/lib/ads-strategy/stop-loss.ts` + `stop-loss.test.ts:151-220` | 子牙 B4：`executeStopLoss` 零生产调用方但签名摊着系列级写函数，随时能被重新接上变成完整绕过 Kernel。保留 `resolveBudgetLocation` / `planCut` / `summariseCut` / `STOP_LOSS_CUT_RATIO` 纯函数 |

## 六、验证计划（PM 2026-09-26 硬规矩：交付前必须真跑通）

### 建表环节
- 本机 Postgres 17 沙盘先跑一遍 v2 migration，验触发器真挡住 UPDATE/DELETE、`release_shape` CHECK 真挡住 kind='trip' + trip_event_id 非空、`release_by_human` 真挡住 actor 不带 `human:` 前缀
- PM 批准 apply 后在生产库 `glbdnayojixmexgofbsd` 上按 v2.1 §12 硬门顺序：**先 apply migration 再合并代码**（否则表不存在，resolver 返回 unavailable，全客户全 bounded 动作被拒）

### 熔断链路
- 单元：`circuit-state.ts` 6 种派生态、`circuit-detectors.ts` 各判据、admin 解除接口非 admin 拒 + body actor 被忽略
- 集成 · 派生态到 Kernel：`envelope-facts.ts` 查熔断 → 返回 unavailable → `authorize.ts` deny(outside_autonomy_envelope)
- 变异 · 真信封 CBO：见 §三 变异 1
- 变异 · 真熔断阻挡：见 §三 变异 2

### 止损路径（这是这次的重头戏）
- 单元：路径修复相关（B2 前端、B4 人工信封分派、B5 accountDayKey、翻页 + 系列回读）
- 集成 · 端到端：假件 CBO 快照 + 人按暂停 → 拿到 `allow` → capability handler 记录调用参数
- **真按一次（PM 提供哪个客户/哪条广告）**：合并前在 CTS 或 NAL 上真按一次止损·暂停，贴出：
  - `action_runs` 那 N 行（每广告组一行）status=succeeded
  - `authorization_decisions` 那 N 行 outcome=allow
  - Meta 后台截图证明真停了
  - `flywheel_actions` **那一行**（统筹 C3 二选一，我选①：**一次决策只投一行**，`action_type='ads.pause_adset'`，被停的 adset 列表放 `payload.adset_ids`）—— 只改名不解决魏征的顾虑（N 行共享同一个系列级 outcome → `admin/flywheel/aggregate` 按 `action_type` 聚合时样本量和权重虚高），改名只是把虚高搬到新 key 上

### 类型检查 + Lint
- `npm run type-check` 记基线 diff 逐字一致
- 用带 `root:true` 的探针配置 lint 本轮改动文件（`reference-worktree-lint-config-conflict`）

## 七、DeepSeek 用量估算

粗估 12-15 轮 DeepSeek + 若干轮我自己写，估费 US$0.06-0.12。**A 级安全核心 / 跨文件 Kernel 推理我自己写**：
- `boundaries.ts` 三处 + `.eslintrc.json` + 架构测试断言（4 处新增）
- `deps.ts` + `index.ts` resolver 挂载
- `autonomy-envelope.ts` + `authorize.ts` 人工信封分派
- `meta/campaign-writes.ts` 拆分（旁路那三条路由怎么处置见 §零 争议）
- `stop-loss-submission.ts` + `stop-loss/route.ts` cycleDate / triggeredBy / 系列回读
- admin 解除接口路由
- 三份 migration
- `envelope-facts.ts` 的熔断查询接线（DeepSeek 负责 WP2 遗留两处修复 + 按账户取上限）

**其余派 DeepSeek**（每轮 ≤3 文件，用 `--edit-format whole` + `--no-git` + `--no-detect-urls`；已知坑见 `reference-aider-deepseek-oneshot-recipe`）。

## 八、Ledger

本 PR 新建 3-4 张 ledger 卡：
- `2026-09-27-ads-wp3-1b-v2-redo-plan-accepted.md`（decided，指向本文件）
- `2026-09-27-ads-circuit-events-v2-append-only.md`（decided，等 PM 说 go 建表再翻 done）
- `2026-09-27-stop-loss-into-kernel-v2.md`（decided，验证节点：真按一次贴证据）
- `2026-09-27-account-daily-budget-cap-and-panel.md`（decided）

**上一轮那三张 done 卡**（`ads-circuit-breaker-observe-not-deny` / `ads-circuit-events-append-only-table` / `stop-loss-into-kernel`）**同时改成 `failed`**，`verified_ref` 指向本文件，`check_note` 写「上一轮照错设计稿实施，v2 重做取代」。

## 九、审查回路

- 方案文档 = 本文件，先发小秘书 → 转 PM。PM 认 → DeepSeek 动
- 实现完成 → 我自审 + 补齐真按一次的证据 → 统筹再看 → 派子牙 / 魏征 / 狄仁杰三方（含 admin 解除路由 + append-only 触发器 = 权限/安全，狄仁杰必须看）
- **保持草稿 + 正文第一行 `风险级别：A`**
- **不合并、不用 `--admin`、不 force push**
- 顺序：migration 先 apply 再合并代码（v2.1 §12 硬门）

## 十、还在等 PM 的 3 件事（不挡开工）

范围那条已由 PM 亲口 `三个一起` 定掉；Jev 那条统筹已撤回（v2.1 §9.3 + §11.8 + §12 自己就回答了是 WP3.3 才建）。剩下 3 件：

| # | 等什么 | 挡不挡开工 |
|---|---|---|
| 1 | **DROP 生产库那张错 schema 的 `ads_circuit_events`** —— 不可逆，表里 0 行、零调用方，仍须 PM 明确一句 | **不挡**。migration 可以写成文件，**但不许 apply、不许 DROP** |
| 2 | **CTS 的 100 / 50 分别给哪个 `act_` 号** —— 库里没有叫"个人账户"的行，只有 `act_2775766642787274`（主）和 `act_2202695063810470`（ThruPlay 官方），别按 label 猜 | **不挡** PR A 的代码；挡的是「面板里把数填进去」这一步 |
| 3 | **NAL 的目标怎么写库** —— NAL 目前没有生效目标，会被 `no_active_goal` 分支 409 fail closed；`真按一次` 到底在 CTS 还是 NAL 上做也取决于这条 | **不挡**写代码；**挡最终验收**（PM 2026-09-26 硬规矩那条「真按一次」） |

🔴 **这三件按新汇报口径（PM 2026-09-27 回「行」）由统筹去问**，我不直接找 PM —— **唯一例外是第 1 件**（DROP 生产表属撤不回的动作，按 CLAUDE.md §2 必须由动手的人直接问 PM，转述不算数）。

## 十一、还有一份要看的辅助材料

`docs/specs/2026-09-25-ads-wp3-wiring-map.md`（8.9KB，接线图）—— 统筹一起漏了、我上一轮也漏了。DeepSeek 派活之前我先自己通读一遍，确保跟 v2.1 spec 对齐无死角。

---

**下一步**：这份方案发统筹先看（他说过要先过一手），统筹点头再发小秘书转 PM。PM 认（回一句「按此干」或指出要改的）→ 我按 §五 清单让 DeepSeek 写，A 级安全核心那几处我自己写。**PM 认之前一行代码不动。**
