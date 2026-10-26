# 广告 Agent 内核侧设计 v0.3（增量稿：在 v0.2 之上并入魏征 8 条 + 子牙 5 条）· 只设计，未写代码

- 日期：2026-10-21　窗口：119　风险级：**A**
- 阅读方式：本稿是 `2026-10-21-ad-agent-kernel-side-design-v0.2.md` 的**增量修订**。凡本稿与 v0.2 冲突，以本稿为准；v0.2 没提到的部分保持。
- 来源：74 号转述的魏征（8 条）、子牙（A–E 五条）设计审意见；122 号「请求回执台账」设计稿。
- 范围划分：**PR-1 只含不受影响的部分**（解析器+往返测试、批准入口 422、纯函数）；其余（匹配键扩展、`ads.pause_ad`、`compliance_stop`、断路器、扫描）全部在 PR-2，等本稿过审。

## 0. 本稿对应的审查意见 → 修改位置

| 来源 | 意见 | 本稿处理 |
|---|---|---|
| 魏征① | 匹配键只认 `creative_video_ids` 会漏掉 boost 帖子/winner_reel_sync 建的广告 | §1 |
| 魏征② / 子牙A | `compliance_stop` 的触发身份是调用方自报 | §2 |
| 魏征③ | 断路器 `max(3,30%)` 对小账户等于不设防，且宽限到期当天会撞断路器 | §3 |
| 魏征④ | 日期/时区、批准入口校验 | §4 |
| 魏征⑤ | 一条广告多个视频的真值表 | §5 |
| 魏征⑥ / 子牙B、C | 合同唯一权威、`fulfilled` 唯一写入、幂等键 | §6 |
| 魏征⑦ | creative 请求加 `landing_ref`、启用前网站回执 | §7 |
| 魏征⑧ | 禁词与事实核对表 | §8 |
| 子牙A | `compliance` 用途、EnvelopeChoice、目录白名单、撤回要求 | §2 |
| 子牙D | 复用 D3 读取骨架；`ads.snapshot.completed` 作为 PR-2 显式交付；列类型 | §9 |
| 子牙E | 两周验收只保留一条端到端 | §10 |
| 74：122 的台账 | 与 `ad_agent_requests` 分工（保留窄表） | §6.4 |

## 1. 匹配键：video_id + 别名 + 帖子 id 三路，并区分「未声明」和「覆盖缺口」

**问题（魏征①）**：boost 帖子（`boost_post_api`）和 `winner_reel_sync` 建的广告，创意是 `object_story_id` 形态（引用一个主页帖子），快照里只取 `creative.video_id`（`snapshot.ts:218,226`），这类广告的 `creative_video_ids` 会是空数组。按 v0.2 的“空=未声明”，它们会落进宽限期而不是被检出。我今晚还实测了另一半：即使有 `video_id`，它也常常是主页帖子产生的**衍生副本**，id 与素材池里的原始上传不同（官方户 4 条在投广告，4 个 `video_id` 与池里 2 个 `ref` 全部不等）。

**匹配键（三路，任一命中即归属该素材；多路指向不同素材 → 视为歧义）**：
1. `video_id` ∈ `{ref} ∪ alias_refs`（精确相等）；
2. 创意的 `effective_object_story_id`（帖子 id）∈ 素材的 `alias_refs`（别名里既可放视频 id，也可放帖子 id）；
3. 帖子 id → `ad_creative_links.post_id` → 工单 `content_work_orders.published_ref.post_id` → 池里 `kind:'work_order'` 条目（由 ME 自己发布的片子一定能走通这一路）。
- 不按标题、时长、缩略图猜。
- 快照要新增一列 `creative_story_ids text[]`（取自创意的 `effective_object_story_id`），并写入快照 cron（PR-2 的一部分；A 级迁移）；扫描时若快照缺这列，按路 1 能判的先判，不能判的进“覆盖缺口”。

**两种“没对上”必须分开（魏征①）：**
| 情形 | 含义 | 处理 |
|---|---|---|
| 视频有 id，但不在任何素材/别名里 | **未声明**：我们知道它用了哪个视频，只是没人登记推广期 | 按 `undeclared_grace_until` 宽限；宽限期内待办+禁止新启用；到期当天**仍只出红待办，不自动停**（见 §3） |
| 视频 id 数组为空，且账户可用（状态=1） | **覆盖缺口**：系统根本看不出这条广告用什么素材（多半是帖子形态） | **立即红待办**（what：这条广告系统识别不了素材；how：去哪里补别名/改走 ME 发布；href），**不进宽限、不算未声明**；若同时命中路 2/路 3，则按命中结果判 |
| 账户状态≠1 | 本来不投放 | 记“账户不可用，已跳过 N 条”，不算覆盖缺口 |

**实施前只读统计（已做，10-21）**：广告级快照（近 3 天，每条广告取最新一行，ACTIVE 且非 disappeared）共 17 条：CTS 16 条（官方户 2 + 个人号 14）、NAL 1 条，**`creative_video_ids` 为空的 0 条**。限定：①快照滞后（官方户今晚新建的 4 条广告不在内）；②样本里没有 boost 帖子/winner_reel_sync 建的广告（当前没有这类在投广告），所以“0”**只证明现状没有覆盖缺口，不证明这类广告将来会有 video_id**。PR-2 上线前需对“能产出 object_story_id 创意的两条建广告路径”各造一条夹具验证。

## 2. `compliance_stop`：身份、用途、信封分派、目录白名单

**问题**：`authorize.ts:431-445` 的注释承认 `triggeredBy` 是调用方自报；`boundaries.ts:280` 只对 `'human'` 加了目录围栏（`HUMAN_TRIGGER_ALLOWED_DIRS = ['src/lib/action-submission/']`）。如果 `compliance` 信封只靠 `triggered_by='schedule'`，任何能调用提交函数的代码都可以冒充。

**修改：**
1. **用途**：`ads.pause_ad` / `ads.pause_unit` 的 `allowedPurposes` 现只有 `growth`（`registry-ads.ts:90`、`authorize.ts:326-331` 会返回 `purpose_not_allowed`）。两者新增 `compliance`。
2. **是否挂 Goal**：`action_runs` 有 `goal_matches_purpose` 约束：**非 growth 用途不得挂 Goal**（挂了数据库拒绝）。所以 `compliance` run 的 `goal_id` 必须为 null；评估需要的“业务目标”信息放进 `evidence`，不挂 goal。
3. **信封分派**：`EnvelopeChoice` 联合类型由 `'human_stop' | 'ads_autonomy'` 扩为 `'human_stop' | 'ads_autonomy' | 'compliance_stop'`；`autonomy-envelope.ts` 的分派函数新增分支，**默认仍落 `ads_autonomy`**（穷举白名单，新 key 默认收紧）；所有对 `EnvelopeChoice` 做 `switch` 的地方（`gateway.ts`、`authorize.ts`、`envelope-facts.ts` 等，PR-2 开工第一步先 grep 全部使用点并列入 PR 描述）必须加 `compliance_stop` 分支，缺分支用 `never` 穷尽检查在编译期报错。
4. **进入条件（三者同时成立才进 compliance 信封）**：`triggeredBy='schedule'` ∧ `purpose='compliance'` ∧ **调用方文件命中 `COMPLIANCE_TRIGGER_ALLOWED_DIRS`**。目录白名单仿 `HUMAN_TRIGGER_ALLOWED_DIRS`，初始只含一个文件：`src/lib/ads-promo-expiry/scan.ts`（那一个扫描函数）；加架构测试：全仓 grep，除白名单文件外任何文件出现 `purpose: 'compliance'` 或向 `submitActionRun` 传 `purpose:'compliance'` 即失败。
5. **过期事实由内核现场重算**：`envelope-facts.ts` 读取当前 live 状态与素材池，自行得出“是否确实过期且无歧义”，**不接受调用方传入的“它已过期”**；请求体里即使带这类字段也被忽略/拒绝。
6. **撤回**：`compliance` run 的撤回必须 `triggered_by='human'`（并走人工目录围栏与鉴权），系统/定时任务不得撤回（撤回=重开过期广告）。撤回 handler 仍保留以满足结构闸。
7. 其余沿用 v0.2 §1.3 第 1、4、6 条（白名单仅 `ads.pause_ad`，整组全过期时 `ads.pause_unit`；不夹带预算变更）。

## 3. 断路器重做：小账户可用，并与宽限分离

**问题（魏征③）**：`max(3, 30%)` 对只有 2 条广告的官方户等于不设防；而宽限到期那天“未声明”的广告会一次性到期撞上断路器。

**修改——两个独立机制：**
1. **自动停的条件分两档（这是核心）：**
   - **明确过期且无歧义**（该广告所有匹配到的视频都归属**唯一**素材，且其中至少一个 `dated` 并已过 end）→ **可自动停**；
   - **未声明 / 覆盖缺口 / 歧义** → **永远只出待办，不自动停**（包括宽限到期之后）。宽限到期的含义改为“从黄待办升级为红待办 + 禁止启用”，**不是**开始自动停。这样宽限到期当天不会触发任何批量自动动作。
2. **断路器阈值**：单客户单次扫描，**拟自动停数 ≥ 2 且 > 在投广告数的 30%** → 整批转人工（红待办“一次要停 N 条，请确认”），不自动执行。小账户：2 条在投、2 条同时过期 = 100% 且 ≥2 → 转人工。
3. **断路器豁免（防止“正常批量到期”也转人工）**：若这批拟停广告的推广期**在至少 48 小时之前已设定且之后没有被改动**（素材条目记 `promo_window_set_at` / `promo_window_changed_at`，由受限入口写，随审计），则视为“计划内到期”，**不受 30% 阈值约束**，仍自动停并留回执；任何一条的推广期在近 48 小时内被新设/改动，则该条不豁免，整批走人工。这条豁免是我的提议，防的是“推广期被误改/批量写错”，请子牙魏征重点审。
4. 回执记录：拟停数、是否触发断路器、是否豁免及依据（`set_at`）。

## 4. 日期、时区与批准入口校验

- 存储：`promo_window = { kind:'dated', start, end }`，`start/end` 为**新西兰本地日期串 YYYY-MM-DD**，`end` **含当天**。**不另存 `ends_at`**：存两份会漂移；`ends_at` 一律由 `endOfNzDayMs(end)`（Pacific/Auckland，当天 23:59:59）派生，时区是常量不是参数。
- `promoVerdict` 的 `today` 一律由 `nzToday(nowMs)` 得出，`now` 作为参数注入（便于测试），不读系统时钟。（PR-1 已实现，含夏令时用例：11/30 → NZDT，7/1 → NZST。）
- 批准入口校验（PR-1）：`dated` 必须 `end ≥ 今天`；`start ≤ end`；`undeclared` 与 `expired` 返回 422。
- `end ≤ 团出发日`：需要“团出发日”这个事实。素材池里没有；工单 `brief` 里若带 `departure_date` 就校验（超出→422），没带则只给警告不拦（**不猜**）。是否要把出发日变成必填字段，留给 PM/工厂（106）决定，PR-1 不做。
- 受限入口 `POST creative-pool/promo-window`（仅内部员工）写 `promo_window` 并记 `promo_window_set_by / promo_window_set_at`，**每次改动都记 changed_at**（§3.3 依赖）。

## 5. 一条广告多个视频：真值表（任一明确过期且无歧义 → 停）

设一条广告用到视频集合 V，逐个视频得出判定：`E`（明确过期且唯一归属）/`O`（有效）/`U`（未声明）/`A`（歧义）/`G`（覆盖缺口，V 为空）。

| V 里的判定 | 动作 |
|---|---|
| 含 ≥1 个 `E`（不论其它是 O/U/A） | **自动停该条广告**（受 §3 断路器管辖）；歧义/未声明的那些视频**另外**各出待办“无法判定”，**不影响**对其它视频的判定 |
| 无 E，含 U 或 A | 只出待办（未声明/歧义），**不停** |
| 全 O | 不动 |
| V 为空（G）且账户可用 | 红待办（覆盖缺口），不停 |
**三组必测用例（PR-2）**：①`[E, O]` → 停；②`[A, O]` → 不停，A 出“无法判定”待办且 O 不受影响；③`[E, A]` → 停（E 明确），A 单独出待办。另加：`[U]` 不停、`[]` 不停并红待办。

## 6. 合同唯一权威、`fulfilled` 唯一写入、与 122 台账的分工

### 6.1 位置与名称
- 合同代码放 `src/lib/ad-agent/contract/`（zod schema + 类型 + 状态机 + 事件名常量），**由我（119）唯一写入**。
- 事件名统一前缀 `ad_agent.*`；视频稿里的 `ads.creative_request.created` 等一律删除。
- 字段名二选一：采用 **`promo_window`**（不用 `promotion_window`）。
- 平台层用**中性名**：`dimension_key`（维度键）、`offer_ref`（对外要约引用，如某个团）——“团”只出现在旅游 Profile，不出现在共享合同类型里。
- 状态机加入 `pending_pm_approval`：`requested → accepted → pending_pm_approval → executing → fulfilled | rejected | expired | failed`。

### 6.2 `fulfilled` 只能由唯一写入函数设置
- 只有 `markFulfilled(requestId)` 一个函数能把请求置为 `fulfilled`，且**必须先回读 `downstream_ref` 指向的记录并确认成功**（`action_runs.status='succeeded'` 或工单/execution_items 的终态成功），回读失败 → 不置位。
- 加**全仓扫描测试**：除该函数外任何文件不得写 `status: 'fulfilled'`（或等价字面量）；不得在 `ad_agent` 目录之外 import 底层写表函数。
- 数据库侧：能加 CHECK 的加（`status='fulfilled'` 必须有非空 `downstream_ref`），但“回读成功”不能靠 CHECK，仍靠唯一写入函数。

### 6.3 幂等键
`idempotency_key = hash(request_type, client_id, entity_ref, direction, 周期日)`；**去掉诊断规则 id**（同一对象同一方向在同一周期内不因“不同规则命中”重复出请求）。

### 6.4 与 122 台账（`agent_request_receipts`，追加式）的分工 —— 最终口径（以 122 稿最新一版为准，取代我先前“取消索引表”的想法）
- **我的 `ad_agent_requests`（窄表）= “请求是什么 + 当前状态”**：`request_id uuid PK`、`client_id`、`request_type`、`status`、`contract_version int`、`contract jsonb`（合同正文快照）、`idempotency_key text unique`、`valid_until`、`created_by`、`created_at`、`updated_at`、`downstream_ref jsonb`（只放引用：`action_run_id` / `execution_item_id` / 工单 id）。**不存回执、不存成本/批准人/平台回执号。**
- **122 的 `agent_request_receipts` = “每一步发生了什么”**（谁做的、谁批的、成本、no_publish、授权引用、平台回执号、下一步谁/最晚何时），追加式；**不存合同正文、不存当前状态副本**。
- **状态同步**：当前状态只由 122 的唯一写入函数在追加回执的**同一事务**里更新 `ad_agent_requests.status`（台账的缓存，可由台账重建）；其它任何代码不得写 `status`。`fulfilled` 仍须 `markFulfilled` 回读成功（§6.2）——它在同一写入函数内执行。
- **合同代码与迁移的写入者**：合同（`src/lib/ad-agent/contract/`）与 `ad_agent_requests` 迁移由我写；台账迁移与写入函数由 122 写；两边迁移分开 PR，互不夹带。
- **status 枚举（合同权威）**：`requested | accepted | pending_pm_approval | executing | fulfilled | rejected | expired | failed`。台账的 `status` 取值引用同一常量，不另起一套；台账里的 `executed/completed/approved/...` 是**回执阶段**，不是请求状态，二者靠映射函数（放合同目录）转换。
- **request_type（中性名）**：`budget | audience | creative | page | seo`，另加 `launch`（见下）。
- **`launch`（开投）**：允许作为 `request_type`，但是**只观察、不执行**——不允许 Agent 创建可被执行器消费的 launch 请求；开投只认 PM 本人，launch 行由 122 的体检/盯盘函数创建，仅承载阶段回执；`markFulfilled` 不适用于 launch（其终态由 122 的回执置位）。
- **事件前缀统一** `ad_agent.request.<verb>`（取代 122 旧稿的 `ads.agent_request.*` 与视频稿的 `ads.creative_request.*`）。
- 内核现状（回答 122 的“能不能带 triggered_by='agent' + triggered_by_ref=request_id”）：**能**。`SubmitActionInput` 有 `triggeredBy` 与 `triggeredByRef?`（`runner.ts:47-49`），落库 `runner.ts:201-202`；`action_runs.triggered_by` 的 CHECK 允许 `'agent'`。两点提醒：①`'agent'` 与 `'schedule'` 目前没有目录围栏（只有 `'human'` 有，`boundaries.ts:280`），建议同样加调用方目录白名单+架构测试；②`triggered_by_ref` 是自由文本、无外键，同步器要容忍悬空引用。

## 7. creative 请求：`landing_ref` 与启用前的网站回执
- `creative_request` payload 增加 `landing_ref`（落地页引用）。
- **启用前闸（PR-2 之后，随 W2）**：广告启用（`activatePublished`）前，除 §v0.1 的推广期复核外，要求该 creative 请求链上有网站 Agent 的回执“页面已上线且追踪事件正常”（来自 122 台账的 `completed` 回执或追踪体检 `ads-tracking-preflight` 的绿灯）；缺回执 → fail closed，不启用。网站 Agent 本身属 W3，所以这条闸**先实现为“有 `landing_ref` 时校验，没有则按现状放行并记警告”**，待网站 Agent 上线后收紧为必填。

## 8. 禁词与事实核对表（W1 必交付）
- 机器可读清单（放 Playbook/配置层，不进共享代码常量）：禁词/须核事实/供应商名封装，例如“高铁只写 High-speed train and coach”、“3 月团无早鸟”、第三方封装名（见 CLAUDE.md 封装名规则）。
- 校验函数 `checkCreativeCopy(profile, text) → Violation[]`，用于 creative 请求生成前、起草广告门（`validateDraft` 旁）、苏东坡质检前置自检。
- W1 验收反例必须包含：**文案含“高铁”/“早鸟（3 月团）”→ 被拒**。
- 事实（价格/日期）仍以官网实读为准；本函数只拦禁词与已知冲突，不替代官网核对。

## 9. 扫描实现与数据面（子牙 D）
- **复用** `src/lib/inngest/functions/ads-d3-auto-pause.ts` 的读取与去重骨架（回库读开关→读诊断/快照→逐实体共用账户二次检查→算幂等键→已记录则跳过），不另写一套。
- **`ads.snapshot.completed` 列为 PR-2 显式交付**：快照 cron（`/api/cron/ad-entity-snapshot`）目前没有发 Inngest 事件，需新增事件及发送点；扫描函数以它为叫醒铃，同时保留每日 00:05 定时兜底。
- 列类型：`ad_entity_snapshots.creative_video_ids` 为 `text[] NOT NULL DEFAULT '{}'`（迁移 `20260914000001`:69）；新增 `creative_story_ids text[] NOT NULL DEFAULT '{}'`（§1）。
- 快照新鲜度：扫描必须先判快照时间（超过约定窗口则改走 live 读取或先刷新）。10-21 实测官方户广告级快照停在 10/20 06:31Z，早于今晚新建的 4 条广告；不判新鲜度的扫描会漏掉它们。

## 10. 验收与分期（子牙 E）
- **两周验收只保留一条端到端**：诊断 → creative 请求 → `execution_items`（经 `/execution` + `promo_ref`，105 的素材缺口任务设计 §0/§1）→ 视频 Agent（上海）→ 回执（122 台账）→ T+7 对账排期。
- 网站 / SEO Agent 降为 **W3+**（标“设计稿”），本期不要求闭环。
- `undeclared_grace_until`：**PR-2 前置条件**（74 向 PM 要）。A2/B3 在 PM 回“A2B3推广期到11/30”后声明为 `dated`（`promo_end=2026-11-30`）并写入别名（74 已用 Meta 读 creative 核实：A2 池 ref=28843889985273791 的别名 `[2052942792039743, 2324048611775779]`；B3 池 ref=3626096160888481 的别名 `[1126238526529263, 1110954791640892]`；官网点击/私信两个已停系列另有衍生副本，需要时再查），则当前没有“未声明”的在投视频，enforce 开关当天不会误停。
- creative 请求只走 `execution_items + promo_ref`；回执只存 `action_runs` / 工单**引用**；`request_id` 写 `triggered_by_ref`。

## 11. PR 切分（修订）
- **PR-1（立刻做，A 级，草稿）**：`promo-window.ts`（纯函数）、素材池解析器（`promo_window` + `alias_refs`）与往返测试、批准入口 422、受限入口 `POST creative-pool/promo-window`（写 `set_by/set_at/changed_at`）。**不含**：起草门、`ad-publisher` 封顶/启用复核（等匹配键与 §4 最终口径）、任何内核/扫描改动。
- **PR-2（等本稿过审）**：`creative_story_ids` 迁移与快照；`ads.snapshot.completed`；`ads.pause_ad` + `compliance_stop`（含 §2 全部围栏）；断路器 + 豁免；扫描函数（§5 真值表）；回执与待办；`ad-publisher` 封顶与启用前复核。
- **随 122**：合同接入台账；`markFulfilled`。
- 不做：自动重新激活；其它客户开启（默认 off，按客户配置开）。

## 12. 未核实 / 风险
- `ads-autonomy-sync` 新增 action_key 的确切登记点、`dedicated-approval-entries` 是否适用 `ads.pause_ad`、Meta 对已暂停广告再 POST status 的返回形态（沿 v0.2）。
- “断路器豁免”（§3.3）是我的新提议，未经审查。
- 实测统计只覆盖现有在投广告；boost/winner_reel 路径的创意形态需夹具验证（§1）。
- 我这一轮写的 PR-1 代码里，`circuit-state.test.ts` 等若干既有测试在本机失败，**归因未确认**（它们不 import 本次改动的文件；未与 origin/main 同环境对比）。
