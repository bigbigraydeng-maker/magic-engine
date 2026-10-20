# 广告 Agent 内核侧设计 v0.4（增量稿：并入子牙复审 7 条 + 魏征复审 10 条）· 只设计，未写代码

- 日期：2026-10-21　窗口：119　风险级：**A**
- 阅读方式：在 `v0.2` + `v0.3` 之上的增量；**与它们冲突处以本稿为准**，本稿没提到的保持原样。
- 已落地的一部分：PR 2964（PR-1）head `9ec8f5fd7` 已处理 §9 里“通用保存接口会抹掉 / 伪造推广期字段”和“推广期设置入口拒过去日期”两条。
- 我已核对属实的代码事实：`boundaries.ts:212-216`（内核调用方只许 `src/lib/kernel/`、`action-submission/`、`kernel-approval/`）、`autonomy-envelope.ts:323`（`EnvelopeChoice` 现为两值）、`envelope-facts.ts:36-45`（`CHANGE_KIND` 表没有 `ads.pause_ad`）、`creative-link.ts:93`（`normalisePostId`）、`ads-d3-auto-pause.ts:165`（`verifyAdsetOwnership`）、`gateway.ts` 对 `outward + provider_native` 动作强制要求撤回 handler。其余行号按两位审查员的读码结论写，我没有逐条重读。

## 1. 撤回：`ads.pause_ad` 的撤回处理必须是 noop（子牙1，阻塞）

- 事实：`pause-unit.ts` 的撤回把状态写回 ACTIVE；内核在 apply 之后任一步失败（例如回读超时）会**自动**调撤回。若 `pause_ad` 照抄，失败路径会**自动把过期广告重新开起来**。内核本来就没有“人工撤回”入口，v0.3 §2.6 描述的“只有人工二次确认才能撤回”这条路径不存在，**删除**。
- 设计：`ads.pause_ad` 仍声明 `rollback:'provider_native'`（结构闸要求有 handler），但 handler **是 noop**：返回 `{ok:true, rollbackKind:'noop', detail:{reason:'合规停止不自动撤回，重新开启只能由人在 Meta 后台手工做'}}`，**不调用任何 Meta 写接口**。
- 失败路径的结果：apply 写 PAUSED 之后即使回读超时，广告保持暂停（安全方向）；回读失败只影响回执状态，不会重开。
- 测试：①handler 被调用时断言“没有任何 Meta 写调用”；②模拟 apply 成功、readback 失败，断言最终没有 `status: ACTIVE` 写入；③重新开启不属于任何自动路径（全仓扫描：`ads.pause_ad` 相关文件里不得出现 `ACTIVE` 写入）。
- `ads.pause_unit` 在 `compliance` 用途下同样：整组停的场景下，`pause_unit` 现有撤回会重开广告组。因此 **`compliance` 用途下只用 `pause_ad`**，“整组全过期”也用逐条 `pause_ad`（组内每条都停），**不用** `pause_unit`，避免触碰现有撤回语义。（这修改 v0.3 §2.1/§2.7 的“整组全过期用 `ads.pause_unit`”。）

## 2. 提交方目录与架构测试（子牙2，阻塞）

- 内核调用方只许在 `src/lib/kernel/`、`src/lib/action-submission/`、`src/lib/kernel-approval/`（`boundaries.ts:212`）。v0.3 写的 `src/lib/ads-promo-expiry/scan.ts` 直接调内核会违反这条。
- 改为参照 D3：扫描函数（可放在 `src/lib/ads-promo-expiry/scan.ts`）**只做读取、判定、预告**，提交一律经 `src/lib/action-submission/ads-promo-expiry-stop.ts`（新建的**专用提交模块**，仿 `ads-auto-pause.ts`）。
- `COMPLIANCE_TRIGGER_ALLOWED_DIRS` 实际白名单项 = 那个专用模块的**文件路径**；架构测试全仓扫描：除该模块外任何文件出现 `purpose: 'compliance'` 或向内核提交 `compliance` 用途即失败。
- 诚实标注：这和现有 `human` 的围栏一样，**只是静态约定，不是运行时保证**（同目录内的别的代码仍可冒用）；运行时的保证来自 §3 “事实由内核重算”和 §4 “预告指纹”。

## 3. 内核里“事实”的真实来源与 4+1 处改动（子牙3，阻塞；魏征1的措辞更正）

**更正 v0.3/v0.2 措辞**：`envelope-facts.ts` 读的是 `ad_entity_snapshots`（内核在 apply 前自己抓的 `kernel_pre` 快照，秒级新鲜），**不是 Meta 实时数据**；“现场读 live”应改为两层：
- **信封层（内核）**：从刚抓的 `kernel_pre` 快照 + 素材池（本次重新读取）重算“这条广告用到的视频 / 帖子 id → 是否明确过期且无歧义”，不接受调用方传入的结论。
- **执行层（capability apply 步骤，写 PAUSED 之前）**：对该广告**现场回读 Meta**，取 `creative.video_id` 与 `effective_object_story_id`，与扫描时依据的值逐项比对；**不一致即中止**（不写、记 `aborted_creative_changed`、下一轮重扫），防止快照滞后导致“广告已换素材却被误停”（魏征1，严重）。

**接口改动（四处必须进设计，否则 `ads.pause_ad` 会被全部拒绝或被当成自治信封）：**
1. `selectEnvelopeVerdict` 入参加 `purpose`（及 `triggeredBy`）；
2. `preProviderEnvelopeBlockReason` 的 run 类型加 `purpose`；
3. 事实解析器：现在 ctx 只有 `runId`，要由 runId 读 `action_runs`（取 `purpose`、`input`）再解析；
4. `EnvelopeFacts` 目前是预算形状，新增可选 `promoExpiry?: { adId; videoVerdicts; storyVerdicts; entryFingerprint; previewId }`（compliance 才有）；
5. `envelope-facts.ts` 的 `CHANGE_KIND` 表（:36）和 :423 的 `switch` 加 `'ads.pause_ad': 'pause'`——**不补会被全拒**。

**`EnvelopeChoice` 的真实使用点**：`authorize.ts:447/457`（三元）和 `outward-authorization.ts:188`；`gateway.ts` / `envelope-facts.ts` 不引用它（v0.3 写错）。加第三值 `'compliance_stop'` 不会让三元报错、只会被误当成自治信封——所以**先把三元改成真正的 `switch`，再在 `default` 里用 `never` 穷尽检查**。
- `goal_id` 必为空（DB CHECK `20260808000003:280`，非 growth 不得挂 goal，v0.3 方向正确）；后果写明：**compliance run 没有 goal，依据放在 `evidence`，不参与 T+N 归因**。

## 4. 豁免/预告机制重做（子牙4 + 魏征2，阻塞）

**废止**：v0.3 §3.3 的“≥48h 前设定且未改动 → 豁免断路器”（依据 `set_at/changed_at` 不可靠：直改库不更新时间戳；通用保存接口曾抹掉字段；别名误挂到 6 天前设好的已过期素材会被“豁免”批量停；把 12 月误写 11 月会在 48 小时后整批停且无人复核）。`promo_window_set_*` 字段保留作审计信息，**不再用于任何放行判断**。

**新方案（预告 + 指纹 + 人工可见）：**
1. **指纹**：对整条素材条目取 SHA-256：`{ref, 排序后的 alias_refs, promo_window, status}`（不含时间戳）。
2. **到期前 72 小时“预告”**：扫描在每条素材到期前 72 小时（`end` 含当天，按 NZ 日期算）生成预告记录：将被自动停的**广告 id 清单**、对应素材、**固化的指纹**、预告时间，并出一条待办“将在 M/D 自动停这些广告”（what/how/href，让 PM 看得到，例如 11/30 官方户 4 条同日全停属计划内，必须在预告里直接列出来）。预告写入一张小表 `ads_promo_expiry_previews`（客户、预告 id、广告 id 集、指纹、状态；追加+终态不可改；PR-2 迁移）。
3. **到期当天自动停的前置条件**（缺一不可）：广告在已存在的预告里 ∧ 预告时间 ≥ 72 小时前 ∧ 素材**当前指纹 = 预告里固化的指纹** ∧ §1/§3 的现场校验全部通过。
4. **不满足时**（没有预告 / 指纹变了 / 广告不在预告里，例如临时新建或刚改了日期的素材）：**只出待办，不自动停**；这包括“推广期少于 72 小时的短促销”——它们不会自动停，只会提醒（取舍写明：合规自动停以 72 小时可见度换取防误停；短促销由待办 + 人工处理；PM 可对个别客户调小预告时长，但不得为 0）。
5. **断路器**与预告关系：有有效预告的批次不受占比约束（因为 PM 在预告里已经看见了它们）；没有预告但“明确过期”的广告永不自动停，所以断路器的必要性主要保留给“预告通过但数量异常”的情形，见 §5。
6. **升级时钟**：任何被拦下转人工的批次（预告缺失、指纹变化、断路器）都有 `blocked_at`；**超过 6 小时仍无人处理 → 升级为红待办**，之后每日重复，直到处理；不能因为“转人工”就让过期价格一直在线无人知晓。
7. 直接改库不更新时间戳的问题：指纹覆盖内容本身，不依赖时间戳；任何内容变化都会使指纹失配。

## 5. 断路器改小账户可用（魏征4，高）

- 废除“占比”作为唯一判据（CTS 官方户 2 条同日到期 = 12.5% 不触发；NAL 1 条永远凑不够）。
- 新规则：同一客户同一次扫描里“拟自动停条数 ≥ 2”**或**“占在投广告数 > 30%”→ **转人工**，**除非**整批都满足 §4 的预告条件（预告≥72h、指纹未变）——此时视为计划内，自动停并留回执。
- 无预告的“明确过期”不自动停（§4.4），所以小账户不会因为凑不够数而绕过校验：单条也必须有预告。
- 回执记录：拟停数、占比、是否命中预告、指纹比对结果、是否转人工、`blocked_at`。

## 6. 匹配键细化与覆盖缺口（子牙5 + 魏征5、6）

**快照要采全（子牙5，先决）**：`portfolio/snapshot.ts:226` 的 `normalizeAd` 只取一个 `creative.video_id`；轮播/动态素材会读出空，导致 V（视频集合）元素数只有 0 或 1。PR-2 先扩快照：
- `creative_video_ids`：收集广告用到的**所有**视频 id（含 `child_attachments`、`asset_feed_spec`）；
- `creative_story_ids text[]`：所有 `effective_object_story_id`；
- `creative_kind text`：`video | image | carousel | dynamic | post | unknown`。

**路 2（帖子 id）**：匹配前先用 `normalisePostId`（`creative-link.ts:93`）把 `pageId_postId` 与裸 id 归一；素材别名里的帖子 id 同样归一后再比。**路 3 改走** `ad_creative_links.ad_id → creative_ref`（不再从帖子 id 反推工单），并接受老广告走不通（记为“无链接”，不是错误）。

**覆盖缺口的精确定义**（魏征6，避免永久误报）：
- 仅当 `creative_kind ∈ {video, post, dynamic, carousel, unknown}` 且三路都没有任何命中且视频集合为空，才报缺口；`image` 类广告**不算缺口**（没有视频，不受推广期约束）；
- 排除 `disappeared` / `NOT_RETURNED` 行；仅限“在投”状态（`DELIVERING_STATUSES` 同一集合）；
- 只有该账户的 `ad_snapshot_captures.complete = true` 的那一轮才下结论；配置读失败（fallback）**不算“全部未声明”**，记为“读不到”，不出缺口待办；
- 共用账户不写广告层快照的情形不报缺口；
- 待办去重键 `promo_coverage_gap:{client_id}:{ad_id}`。

**自相矛盾的澄清（子牙5）**：v0.3 §3.1 的“所有匹配视频都归唯一素材才可自动停”与 §5 的 `[E,A]` 冲突，**统一为**：逐个视频独立判定；歧义（A）只让**该视频**判为“无法判定”，不影响其它视频；广告只要有一个视频为 E（明确过期且唯一归属），且满足 §4 全部前置条件，就自动停。`[E,A]` → 停；`[A,O]` → 不停。三组必测用例不变。

## 7. 其它子牙/魏征条目

- **landing_ref 闸（子牙6）**：“缺 landing_ref 则放行”是**临时**措施，明写：启用广告是烧钱动作，规矩本是“缺回执就拦”。收紧条件：客户配置 `landing_receipt_required`（`ad_strategy_configs` 新列，默认 false），在网站 Agent（121）对某客户产出第一份“页面已上线且追踪事件正常”的回执之日起对该客户置 true；置 true 后缺回执 → fail closed。
- **扫描复用范围（子牙7）**：D3 骨架（`ads-d3-auto-pause.ts`）的尾巴是“提交后等人批准”（`ads-auto-pause.ts`），与本场景目的相反。**只复用读取与去重部分**；提交部分新写（§2 的专用模块）。幂等键里的“周期日”明确为 **NZ 日期**。
- **`verifyAdsetOwnership`（魏征8）**：D3 骨架里的这个校验（组内广告都属于客户登记的主页）**必须带上**，防止误停别家的广告。`pause_ad` 的归属校验 = 该 ad 所属 campaign ∈ 客户登记账户（`envelope-facts` 已有）∧ 该 ad 所属广告组通过 `verifyAdsetOwnership`。
- **刹车在哪（魏征8）**：`compliance_stop` **不受** `autonomy_mode` 与 `autopilot_dry_run` 管辖（前者管“自治信封里的放/收类”，后者只管 D3）。PM 的刹车有三道：①客户级开关 `creative_promo_expiry_mode: off | detect | enforce`（`detect` 只出待办）；②内核策略表里 `ads.pause_ad` 的审批模式——若策略不是 `auto_approve`（例如 `observe` 客户同步成 `require_approval`），compliance run 就**排队等批准**，由待办呈现，而不是自动执行；③断路器与预告前置条件。`dry_run` 与本功能无关，文档中不得混用。
- **evergreen 档位（魏征9）**：已有（`PromoWindow.kind:'evergreen'`，PR-1 已实现）；补充规则：画面含日期/价格的工单禁止选 evergreen（工厂对账表一列）。
- **`undeclared_grace_until`（魏征9）**：存**客户级配置**：`ad_strategy_configs.creative_promo_grace_until date`（PR-2 迁移）。宽限内：未声明视频的在投广告→每日黄待办；到期后：升红待办 + 禁止新启用，**仍不自动停**（v0.3 §3.1）。A2/B3 在 PM 回话后声明为 `dated`（11/30），则当前无未声明在投视频。
- **11/30 官方户 4 条同日全停（魏征9）**：属“计划内”，必须在 11/27（11/30 前 72 小时）的预告待办里**逐条列出**让 PM 看到，并附“如不想停请先改推广期”的操作入口（受限入口）。

## 8. `status` 同步与 `fulfilled`（魏征7、10）

- `ad_agent_requests.status` 的更新写成**存储过程/RPC** `ad_agent_apply_receipt(request_id, expected_old_status, new_status, receipt_seq, …)`：`UPDATE … WHERE request_id = $1 AND status = $expected_old` + 行锁；**终态（`fulfilled | rejected | expired | failed`）不可被覆盖**；回执乱序到达时按 `receipt_seq` 排序，序号小于已处理者忽略。该函数归 122 写，合同（我）定义语义；两张表的迁移分开 PR。
- `fulfilled` 的 CHECK 不能只要求 `downstream_ref` 非空（`{}` 也会通过）。定义：`downstream_ref = {kind, id, terminal_status}`，且 `terminal_status` 必须属于**按 `kind` 约定的“终态成功”集合**，由 `markFulfilled` 回读下游后写入、**不接受调用方提供**：
  - `kind='action_run'`：`action_runs.status = 'succeeded'`（已核对该枚举含此值）；
  - `kind='execution_item'` / `'work_order'`：具体“成功终态”枚举值我**尚未核对**，PR-2 前必须对这两个表的状态枚举核对后写死；核对不到的 kind 暂不允许 `fulfilled`（fail closed）。
- CHECK 形态：`status <> 'fulfilled' OR (downstream_ref ? 'kind' AND downstream_ref ? 'id' AND downstream_ref->>'terminal_status' = ANY(allowed_success_for(downstream_ref->>'kind')))`。

## 9. 并发写与通用保存接口（魏征3）

- **PR-1 已处理**（head `9ec8f5fd7`）：通用 PATCH 重写素材池时按 ref 保住推广期/别名/时间戳；请求体带这些键 → 400；读不出现有素材池 → 503。
- **仍待做（PR-2 迁移统一加）**：`ad_strategy_configs.creative_pool_version int not null default 0`；批准入口、推广期入口、通用 PATCH 三处写素材池都改成 `UPDATE … WHERE client_id=$1 AND creative_pool_version=$expected`，返回 0 行 → 409 重试，防止“整数组读改写”丢更新。该列之前，三个写入点各自仍是读改写，风险已知。
- 推广期字段只允许 `promo-window` 入口写（PR-1 已用请求体拦截 + 保留实现）。

## 10. 修订后的 PR 切分与前置
- **PR-1（已开，草稿，head `9ec8f5fd7`）**：解析器+往返测试、批准入口 422、受限入口、通用 PATCH 保护。
- **PR-2a（迁移与快照，先于动作）**：`creative_story_ids` / 扩采 `creative_video_ids` / `creative_kind`；`ads.snapshot.completed` 事件；`creative_pool_version`；`creative_promo_grace_until`、`creative_promo_expiry_mode`、`landing_receipt_required`；`ads_promo_expiry_previews`。
- **PR-2b（动作与信封）**：`ads.pause_ad`（noop 撤回）、`compliance_stop` 信封与 §3 五处接口改动、专用提交模块与目录围栏。
- **PR-2c（扫描）**：预告 → 指纹 → 自动停；断路器；升级时钟；覆盖缺口；回执与待办；起草门与 `ad-publisher` 封顶/启用复核。
- 都是 A 级；每个 PR 钉签字 SHA；PM 回“合 N”才合。
- **前置**：`undeclared_grace_until`（或 A2/B3 声明）、`execution_items`/`work_order` 成功终态枚举核对、对 boost 帖子 / `winner_reel_sync` 两条建广告路径各造夹具验证创意形态。

## 11. 未核实 / 风险
- 我没逐条重读：`gateway.ts:1266-1300` 自动撤回细节、`authorize.ts:431-457` 与 `outward-authorization.ts:188` 的具体写法、`portfolio/snapshot.ts:226` 的 `normalizeAd`（按审查员读码结论写）。
- “72 小时预告 + 指纹”是新增机制，短促销（<72h）因此不自动停只提醒——这是明确的取舍，请子牙魏征复核。
- 预告记录的新小表和待办文案尚未设计到字段级，PR-2a 开工前补。
- 本机仍有若干既有测试在红（如 `circuit-state.test.ts`），归因未确认，与本设计无关。
