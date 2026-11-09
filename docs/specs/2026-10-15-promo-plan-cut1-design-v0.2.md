# 推广计划第一刀设计稿 v0.2（三审后定稿）· 116 号窗口 · 2026-10-15

v0.1 经子牙（架构）、魏征（挑刺）、狄仁杰（攻击验证）三审，**结论一致：v0.1 的 A1 是"外形 fail-closed、实质 fail-open"**，
并另外查出三个后门和一个"指纹是摆设"的硬伤。本稿是按三审结论改过的定稿，v0.1 作废（只留历史）。

**一句话**：把"人填表、人点批准"改成"系统起草好、人只看改授权"；先把批准链真正焊死。
**风险级**：A。**只做 CTS、East Inter**。不新增能力线（广告支柱 + Kernel 治理的既有扩展）。
拆 PR：**PR-A 批准链加固** → **PR-B AI 起草广告**。顺序不能换。

---

## PR-A 批准链加固

### A1 · 批准前的硬检查：扩到所有含广告的阶段，但按"到期"分档
**v0.1 的错**：把所有阶段（含三个月后的）的硬门都当批准前置、一律阻塞。
三审指出的真实后果：三个月后的素材今天必然不存在（`gates.ts:147` 要求 `creative_refs` 全在已批准池里），
落地页人工核实记录 28 天就过期（`factFreshnessDays × 4`）——
**唯一的现实出口会变成"去点那个零证据的已核实按钮"或"把计划切碎成单月"**，等于用一次三个月前的签字换三个月后无人复查。

**定稿做法（三件一起，少一件退回现状）**：
1. **评估范围照扩**：第一阶段 ∪ 所有含 `ads_campaign` 的阶段（v0.1 这部分正确，保留）。
2. **只有"到期阶段"阻塞批准**：`start_date <= today + factFreshnessDays` 的阶段，硬门红/灰 → 阻塞。
   更晚的阶段算出来放进 `deferred_blockers`：写进批准回执、页面按阶段名显示
   「这个阶段还没过关，开始前必须补齐」，**不阻塞批准**。
3. **闸挪到阶段入口**：阶段进入 `factFreshnessDays` 窗口后仍没补齐 → 「按计划继续」拒绝盖章，
   并（第二刀）由诸葛亮每天重跑当期阶段硬门、红了推待办。
   **PR-A 只做"按计划继续"这一半**，每天重跑属第二刀。
**为什么这不是给花钱开豁免**：批准推广计划从来不是花钱授权——广告步骤只建暂停草稿，
真开投要过 `src/lib/ads/spend-activation.ts` 的 `requireSpendActivationAuthority`（只认 PM 本人）。
把未来阶段的素材检查从"批准时"移到"该阶段能动之前"，花钱那道闸一寸没松；
反而补上了今天完全没有的"阶段入口复查"。

附带必修（子牙第 5 条）：合并后的 `results` 会出现同一 `key` 在多阶段各一份，
`gate_snapshot` 按灯计数会翻倍、且分不清属于哪个阶段 → `gate_snapshot.results` 每条加 `phase_id`，
`ApprovalReceipt` 类型同步（旧回执没这个字段要容忍）；`approveButtonState` 的 `short()` 带上阶段名。

### A2 · 鉴权：判据改用既有模式，不蹭 ADMIN_EMAILS
**v0.1 的错**：只写 `isGlobalAdminEmail`，漏了 `allowedClientId === null`
（`whitelist.ts:54-57` 的受限管理员排在 `ADMIN_EMAILS` 之前，两处都配的邮箱会绕过"取更严格"这条不变量）。
**魏征另指出一条更要紧的**：`ADMIN_EMAILS` 同时是开投广告花钱、每日计划真发的唯一授权名单；
把"批准计划"这个高频日常动作挂上去，日常一卡住，解法必然是把员工加进那张名单——
**一加就同时给了他开广告花钱和真发客户社媒的权**。而素材批准、日预算上限用的是 `requireGlobalAdmin`（域名 admin 可、受限 admin 不可）。

**定稿判据**：新增 `requirePlanApproverAccess(clientId)` =
`requirePaidClientAccess(clientId)`（保留 401/402/403 语义）**且** `requireGlobalAdmin()`
（`require-admin.ts:80`，内含拒绝 `allowedClientId`）。与素材批准同档，**不碰 ADMIN_EMAILS**。
不过 → 403 `reason:'approver_only'`。

**换上它的接口（五个，不是三个）**：
1. `POST .../approve`（批准）
2. `POST .../promo/verify`（人工核实——把硬门从灰点绿，与批准是同一个闸的两半）
3. `PUT .../promo`（保存，含日预算金额）
4. `PATCH .../[planId]` **当 `isRevertToDraft` 为真时**（退回草稿 = 撤销批准 + 清掉未开工待办，
   `route.ts:144-163`；`endorsement.ts:125` 一看到 `status !== 'approved'` 就把该计划下自动跑的活全判 stale——
   **客户员工自己批不了，但能一键关停整条自动执行链**）。改 title 这类普通字段保持原档。
5. `DELETE .../[planId]`（归档 + 清待办）
`POST .../promo/acknowledge`（周复核盖章）同样收紧：客户员工不该代 PM 签"看过没意见"。

页面：读到 `reason:'approver_only'` 时把批准 / 核实 / 保存 / 按计划继续按钮**隐藏**（不是置灰）并写一行说明。
核实过：`promo-plan` 页面对 `client-viewer` 档开放（`ServerFeatureLock` 走 `requireDashboardClientAccess`），
所以不能靠页面不显示按钮，接口必须自己拦。

### A3 · 内容版本：指纹必须被下游校验，否则是摆设
**v0.1 的错**（魏征）：只在页面上显示"批准的不是现在这一版"= 只标不拦的语义层，不算一道闸（CLAUDE.md §8）。
而且 `plan_data.promo` 里的金额/受众/素材**从来没有被任何建广告的代码读过**，
唯一真实下游是 `endorsement.ts:119-136` 的 `current_marketing_plan`（它只看 client_id/status/end_date/approved_at）。

**定稿做法**：
1. `promoContentHash(spec)` 放 `promo/content-hash.ts`，**序列化复用 `plan-guard.ts` 的 `stableStringify`**
   （别新写第四份稳定序列化；那一份正是 `promoFieldChanged` 判"是不是同一版"在用的尺）。
   剔除 `checks`（客户端可写、保存时被强制清空、判定不参与）与 `gate_snapshot`。
2. `ApprovalReceipt` 加 `content_hash?: string`；approve 写入。
3. **`endorsement.ts` 真去校验**：`MarketingPlanAnchor` 加两个可选字段（当前 promo 指纹、回执里的指纹），
   两者**都有且不同** → `stale_marketing_plan`（fail-closed）；任一缺失（旧计划/旧回执）→ 行为不变。
   `auto-run.ts:213` 的 select 补 `plan_data, generation_meta`。
4. 页面提示保留，但在 PR 正文里只能写成"事后告知"，不能写成"钉住了"。
5. `PUT .../promo` 补乐观锁（`.eq('updated_at', …)` + 可选 `expected_updated_at` → 409）。
   `PromoBoard` 要加 `updated_at` 字段（现在 GET 根本没把它给前端，乐观锁落不了地）。

### A4 · 把"灰点绿"这个零证据按钮绑上内容版本（魏征判为致命）
现状：`verify` 唯一校验是 `check_key` 在白名单、`phase_id` 存在；**不要求任何证据、`note` 可空、
不要求该阶段有广告步骤、已批准的计划也能写**。记录落 `generation_meta.promo_checks`，
而退回草稿只搬 `approval_receipt`（`route.ts:157`），**`promo_checks` 原地不动**。
完整绕过路径：给 phase-2 点一次「落地页已核实」→ 退回草稿 → 把该阶段落地页/价格/金额/素材全换掉（`phase.id` 不变）
→ 再批准，旧核实记录 28 天内照样是绿的。

**定稿做法**：
1. `PromoManualCheckRecord` 加 `content_hash: string`（写入时记当时整份 spec 的指纹）。
2. `gates.ts` 判定人工核实项时：记录指纹 ≠ 当前 spec 指纹 → **视为没核实（灰）**，
   reason 写「计划内容在核实之后改过，需要重新核实」。
3. 退回草稿时把 `promo_checks` 一并挪进 `generation_meta.previous_promo_checks`（留底、不再参与判定）。
4. `verify` 拒绝给"没有广告步骤的阶段"点核实（400）。

### A5 · 三处 `generation_meta` 整块覆盖都没有乐观锁（魏征判为致命）
`verify/route.ts:47`、`acknowledge/route.ts:42` 读出整块 `generation_meta` 再整块写回，**无 CAS**；
approve `:123` 也整块写。并发时后写的把对方字段整段丢掉——
verify 晚一步 → `approval_receipt` 消失 → 批准记录变成"已批准但没有批准记录"的红框；
`content_hash` 就存在这块随时会被覆盖的 JSON 里。
**定稿做法**：verify 与 acknowledge 的 update 都追加 `.eq('updated_at', <读出来的值>)`，
写不中返回 409「刚刚在别处改过，请刷新重试」，不要静默成功、也不要 500。

### A6 · 顺手修一个 RLS 坏模板（狄仁杰）
`supabase/migrations/20260524000003_marketing_plans.sql:60` 仍是**漏了 `TO service_role`** 的旧模板
（生产库已于 2026-08-03 批量修过，但照这份迁移新建的 Dev/CI 库就是对匿名访客全裸）。
本 PR 只改迁移文件文本，不动生产（生产已是对的，附只读核实证据）。

### A7 · 测试（PR-A）
三审明确点出：现有 `approval-hardening.test.ts:21` 用 `vi.mock` 工厂整块替换
`@/lib/auth/client-access`，approve 改成 import 新 guard 后会拿到 `undefined`、炸成 TypeError 而不是 403
——**必须同 PR 改掉这个 mock**，否则"测试绿"证明的是假件配合坏代码。

必加用例（每条都要断言"库没被改"）：
- `paid_client` 档打 approve / verify / `PUT promo` / `PATCH {status:'draft'}` / `DELETE` / `acknowledge` → 全部 403 `approver_only`，
  且 `revokePlanTasks` 零次调用；
- 受限管理员（`allowedClientId` 非空，即使邮箱也在 `ADMIN_EMAILS`）→ 403；
- 域名 admin → 放行（与素材批准同档，这是刻意的，写一条断言把判据钉死）；
- verify 给没有广告步骤的阶段点核实 → 400；
- verify → 退回草稿 → 改该阶段内容（phase_id 不变）→ 再批准：人工核实项必须回到灰、`can_approve=false`；
- verify / acknowledge 与 approve 并发 → `approval_receipt` 不得丢失；两个 verify 并发 → 两条记录都在；
- A1：广告只在第二阶段且第二阶段**到期**（在 `factFreshnessDays` 窗口内）素材未批准 → 不可批准；
  同结构但第二阶段在三个月后 → **可以批准**，且 `deferred_blockers` 里有它、阶段名正确；
  「可批准」的断言写成**无红无灰**，不要写"全绿"（含广告阶段的 `ads.budget_within_caps` 通过时固定是黄灯）；
- `gate_snapshot.results` 每条带 `phase_id`，同一 `key` 多阶段重复时计数不虚高；
- `content-hash`：键顺序 / `checks` / `gate_snapshot` 不同 → 同指纹；任一金额/受众/素材/日期/goal_id 变 → 指纹变；
- `endorsement`：当前指纹 ≠ 回执指纹 → `stale_marketing_plan`；任一缺失 → 行为不变。

---

## PR-B AI 起草广告（按三审修正）

### B1 · 预算：不是"上限 × 比例"，是"余量 × 比例"
**v0.1 的错**（子牙）：`min(账户上限, 客户上限) × 0.5` **没有减去已在投放的预算**，
而 `budget-caps.ts:39` 那道闸也没纳入在投预算、通过时只给黄灯（不阻塞）——建议偏高、闸不拦、批准通过。
`src/lib/ads-strategy/launch-budget-headroom.ts:93 computeLaunchHeadroom` 存在的理由正是这个错
（文件头记着 2026-10-06 卫青查出"按近期实际花费算余量比设定口径宽松 $14"）。
**定稿**：建议值 = `computeLaunchHeadroom` 算出的剩余余量 × 剧本比例；`ok:false`（读不全）→ 不给建议。

**魏征另指出一个口径错**：上限是**两层**——每账户汇总、全计划汇总（`budget-caps.ts:74-95`），
不是逐步骤。一个阶段三个广告步骤各拿 0.5×客户上限 → 合计 1.5 倍 → 采纳后 `PUT` 直接 400。
**定稿**：建议按"该阶段同账户步骤汇总不超账户上限、全计划汇总不超客户上限"分配；
测试按多步骤多账户造，并加一条"采纳建议后 `PUT` 必须能存进去"的往返测试。

### B1a · 预算建议必须守的广告经验（读了 playbook-ads-meta-general §二十二/三十二/三十三/三十四）
1. 历史单条成本**同时报 30 / 14 / 7 天三窗口，以最近的为准**（2026-10-09 CTS：30 天 $8.28 达标、7 天 $10.52 不达标）；
2. 窗口内结果 < 20 条 → 标「样本不足，判不了」，不参与换算；
3. 剔掉 `account_status !== 1` 的日子与追补尖峰日（当日花费 ≥ 设定 1.5 倍），并写明剔了哪几天；
4. 同时给出近 7 天**真实日花费**最高值；≥ 上限 95% → 建议值再压半并给 warning。
   **真实花费必须从 `level='campaign'` 行聚合**（迁移 `20260721000001:21-22` 明写不许信账户层汇总：
   CTS 账户里还挂着别家客户的老系列）；
5. warnings 固定一句「只按日上限算，库里没有月预算口径」（CTS 实证：月基金是两平台合计，日上限×30 数学上就超）；
6. 口径可能中途改过：依据里写 `primary_result` 最后改动时间，读不到就标判不了；
7. **永不输出"建议加预算 / 建议开投"这类动作结论**，只给候选值 + 依据。

### B2 · 受众：复用既有口径，不自己发明
（子牙/魏征）必须照 `portfolio/diagnostics/loader.ts:203` 的既有口径：
- 排除最新一行 `capture_reason === 'disappeared'`（已归档/删除的受众）；
- 分页排序要带 `level/entity_id` 兜底（单键 `captured_at` 排序会漏行，Codex 2026-09-27 修过）；
- 「没读到」vs「这个客户真没有受众」的权威来源是 `ad_snapshot_captures`，**不是"查出来 0 行"**
  （共用账户只写 account 级，受众 0 行完全可能是设计使然）；
- 人数门槛用既有常量 `D4_AUDIENCE_FLOOR`（`thresholds.ts:42`），不要造第三个 1000；
- `audience_count_lower` 被刻意排除在快照 hash 之外（`snapshot.ts:289`）= 这个数天然滞后且常为 null，
  **null → 不给建议**，绝不 `?? 0` 比较。

### B3 · "读不到就留空"必须靠类型强制，不靠自觉（魏征判为致命）
`{ value: T | null; basis: Basis[]; why_empty: string | null }` 允许写出 `{value: 0, basis: [], why_empty: null}`。
**定稿改成判别联合**：
```ts
type Suggestion<T> = { ok: true; value: T; basis: [Basis, ...Basis[]] } | { ok: false; why_empty: string }
```
`basis` 非空元组；`ok:false` 分支根本没有 `value` 可渲染，杜绝页面上 `value ?? 0`。
另加表驱动测试：对每个字段枚举「读失败 / null / 0 / 空数组」四种输入，断言一律落 `ok:false` 且 `why_empty` 非空。
最后那段「数据口径硬规则」（邮件已发数显示「未接通」不显示 0）落到同一个类型上。

### B4 · 对外措辞红线：复用 `loadDraftRedlines`，别自己读
（子牙）`src/lib/ads-strategy/draft-redlines.ts:133 loadDraftRedlines` 已经把
`clients.brand_redline_phrases` + `master_briefs.avoid_words` + **`excluded_topics`**（v0.1 漏了）并好，
而且区分 null（读不到）与 `[]`（没配）；`unusableRedlinePhrases` 要求把失效短语记进回执。
CTS（全英文团、无销售截止/倒计时/早鸟）与 East（全英文、面向澳洲本地买家）的词进**客户数据**，不进共享默认值。
对外文字建议的出处**只从库里已有的 grounding 记录取**，取不到就不给建议——
现场抓官网会把同步只读接口拖成偶发超时（那一半要挪出去走 Inngest）。

### B5 · 接口与落点
- `POST .../promo/draft`：guard 同 A2，只有草稿能起草，**只读不落库**，PM 点"采纳"才进表单，保存仍走原 `PUT`。
  按 §3 的例外（纯同步只读、无外部副作用）**不上 Inngest**；PR 正文要写明"为什么是 POST 却不写库"。
- 落点（子牙）：**取数函数放 `src/lib/ads-strategy/promo-draft-facts.ts`**（广告域事实已有三份封装在那里，
  不在 `marketing-plan/promo/` 下再长第四个广告事实层）；`promo/draft-ads.ts` 只留纯算法 + 组装。
- 剧本新增 `draftBudgetShareOfCap`（default 0.5，标 `unvalidated_default`）。

---

## 当场试跑（交付前必做，写进 PR「## 当场试跑」）
1. A1：到期阶段素材未批准 → approve 必须 409 且 blocker 写着阶段名；同结构挪到三个月后 → 可批准且进 `deferred_blockers`。
2. A2：`paid_client` 档对六个接口各打一次 → 全 403；受限管理员 → 403；域名 admin → 放行。
3. A4：verify → 退回草稿 → 改内容 → 核实项必须回到灰。
4. A3：批准后手改库里一个金额 → `endorsement` 把该计划下自动执行判成 stale。
5. B：对 CTS 真实草稿调一次 `/promo/draft`，贴出三项建议与依据；读不到的项必须显示"没读到"而不是 0。
   **注意 CTS 账户当前 `account_status = 3`（欠款未结）**，所以账户可用这道硬门现在就是红的——
   这正是预期行为，试跑时要如实记录，别去绕过它。

## 降级，不删
手填表、`StepFields`、加阶段/加步骤、「看示例计划」、「按计划继续」周点按钮 → 收进「想自己改？展开」，默认不显示。
页面保留为证据层。计划数据结构、广告只建暂停草稿、对账算法、检查清单判断逻辑全部保留。

## 复用声明
复用：`plan-guard.stableStringify`、`require-admin.requireGlobalAdmin`、`ads-strategy` 的
`computeLaunchHeadroom` / `loadClientCapFacts` / `draft-redlines.loadDraftRedlines` /
`portfolio/diagnostics` 的受众口径与阈值常量、`promo/*` 既有纯函数、`endorsement` 既有锚点逻辑。
新增 platform-shared：`promoContentHash`、`requirePlanApproverAccess`、`draftAdsStep`（纯算法）、
`ads-strategy/promo-draft-facts`。行业层：剧本阈值（标未验证）。客户层：CTS/East 的禁用词与团信息，存客户数据。
**与 tier-gate 决策一致**：归位既有广告支柱 + Kernel 治理，没有新增能力线。
