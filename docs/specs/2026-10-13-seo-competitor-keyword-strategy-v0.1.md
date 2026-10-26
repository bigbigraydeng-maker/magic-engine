# SEO Agent 盯竞品词出策略（竞品词级差距 → 处方草稿）设计稿 v0.1

> 状态：设计稿，**不实施**（2026-10-14 按 PM 新规改：原 3 个待答问题已由 agent 自行拍板，见 §7）。风险级 C（只有文档；实施各步的风险级见 §6）。窗口 96，只读调研。2026-10-13。
> PM 原话：「你是否可以盯着我们的竞品的关键字去做一些策略。我觉得这是我们 SEO Agent 应该具备的能力」。已同意竞品查询；付费数据每月上限 US$15（SEO 共用）；SEO agent 要更大胆专业。
> 样例数据（CTS 真实竞品词差距，花费 US$0.156）：[`docs/clients/cts/2026-10-13-competitor-gap-sample-v1.md`](../clients/cts/2026-10-13-competitor-gap-sample-v1.md)
> IMPACT 位置：Inspect + Measure + **Prescribe**（本稿）；Act 沿用已有执行通道；Check/Tune 见 §5。

## 0. 一句话结论

**平台上已经有一半零件，但没有一条链路把它们接成「每周盯竞品 → 出处方」。** 缺的主要是：①名次对比（现有只看「我们没排」，看不到「我们排得更后」）；②相关性/意图过滤（原始差距约九成是噪音）；③处方落点与读取方；④花费账本。样例证明「排得更后」那一半正是最可做的：35 个词里 chengdu 一个词估计就值约 +313 点击/月。

## 1. 现状盘点：已有什么、缺什么、谁在用

| 零件 | 位置 | 做什么 | 谁在用 / 状态 |
|---|---|---|---|
| DataForSEO 封装 | `src/lib/dataforseo/labs-competitors.ts`：`getSerpCompetitors` `getKeywordsGap(WithStatus)`；`labs.ts`：`getRankedKeywords` `getKeywordsForSite`；`serp.ts`：`getSerpPage` | 竞品发现、词差距、单域名排名词、实时 SERP | 被下面几条用 |
| 竞品域名单一读取口 | `src/lib/competitors/resolver.ts` `getClientCompetitors`（优先级：clients.competitor_domains → master_briefs → 自动发现） | 谁的竞品只有一个真相源 | 差距接口、周快照、AI 可见度共用 |
| 竞品词差距接口 + 24h 缓存 | `src/app/api/clients/[id]/seo-intelligence/competitors-gap/route.ts`、`seo-intelligence/competitors-gap-cache.ts` | 页面打开时现算：竞品排、我们**完全没排**的词 | SEO 情报页（人工打开才触发）。**只扫前 5 个竞品；不含名次对比**；缓存里 6 天前那份含 panda / europe tours / vietnam tours 等明显不相关的词 |
| 每周竞品快照 | Inngest `competitor-watch-weekly`（`src/lib/inngest/functions/competitor-watch-weekly.ts`）→ `src/lib/competitors/snapshot.ts` → 表 `competitor_snapshots` | 每个竞品域名拉前 50 个词（月搜≥100），汇总写一行 | **没人读，也没在跑**：全仓只有生产包详情页一处读取（且按 package id 过滤，周快照不带）；CTS 的 `seo_config` 里没有 `competitor_watch_enabled`（2026-10-07 定时任务读取方审计结论 C），表里最新一行是 2026-06-11。回执 `processed` 全 0 |
| 词级基线与检查点 | `docs/clients/cts/2026-10-13-cts-rank-checkpoint-baseline-v1.md`（73 号）、`keyword_snapshots`（每周一快照，NZ 2554） | 9 个目标词名次基线 + 30/60/90/180 天检查点 | 周报；`keyword_snapshots` 实际是「域名排名前 200 的词」，**没有可添加的追踪词名单**，掉出前 200 的词会直接消失；73 号文档说缺 `guilin`、`silk road` 两个词 |
| 自动改标题闸门 | `src/lib/seo-meta/cycle/*`（六道信息完整闸门，`gate.ts`） | 单页标题/描述自动改（仅非保护页） | CTS 已开；本稿的「改页」处方可喂它 |
| 处方落点候选 | 表 `content_strategy_items`（字段含 action_type / proposed_title / rationale / source_keyword / keyword_volume / keyword_kd / priority_score / status） | 内容策略条目 | 已有；**能否承载竞品证据、status 取值有哪些，实施前必须核实（本稿未核）** |

**缺口**
1. 没有「名次对比」：现有差距只看我们没排的词；PM 要的「对手排前 20、我们排得更后」没有任何代码在算。
2. 没有相关性/意图过滤：样例 B 中 241 个词里约九成是 CTS 不卖的目的地或纯信息词。
3. 竞品快照与差距接口两套并存，口径不同（前者前 50 词、后者 domain_intersection），都没有读取方。
4. DataForSEO 没有「SEO 共用 US$15」的月度花费账本（2026-10-08 健康审计明确写「预算账本……没做」；`usage-tracker.ts` 只有按客户累计的记账函数，本稿没核实它被谁调用）。**所以 US$15 上限目前靠人记。** 但平台上已有一套可借鉴的账本：GEO 的「每客户每月预算 + 逐笔预留/结算」（表 `geo_client_budgets` / `geo_budget_reservations`，RPC `geo_reserve_budget_v1`，代码 `src/lib/geo-remeasure/budget-ledger.ts`、`budget-store-supabase.ts`；生产库表已存在、当前 1 行预算）。它的机制（幂等预留、崩溃孤儿可回收、没预算行就拒绝）正是本模块要的，但表名和 RPC 带 `geo_` 前缀、只服务 GEO。
5. 竞品名单来源未确认：CTS 库里 17 个竞品，我只能确认「在库里」，不能确认「经 PM 确认」或「DataForSEO 真实竞品」；4 家实测有数据，`adventureworld.co.nz` 与 `insiderchinatours.com` 在缓存里关键词数为 0。

## 2. 能力定义

**每周对每个开了开关的客户，对竞品域名做词级差距 → 过滤 → 验证 → 出处方草稿。不自动改网站。**

### 2.1 流水线

```
S1 取数(Inspect)   对每个竞品 × 每周 1 次「两边都排」(domain_intersection, intersections=true)
                   + 每 4 周 1 次「对手排我们没排」(intersections=false)
                   参数固定：location=客户主市场，language=en，organic，月搜≥30，按搜索量降序，limit=100
S2 过滤(Measure)   ① 去品牌词（竞品品牌词 + 我们的 brand_terms，复用 `competitorBrandMatch`、`isBrandedKeywordWithAliases`）
                   ② 对手名次 ≤20（两边都排的话还要对手比我们靠前）
                   ③ 主题相关：命中客户主题集（L4）且不命中行业噪音词（L2）
                   ④ 难度可打：KD ≤ 客户难度上限（默认 30，L4 可改；KD 已随回单带回，不额外付费）
                   ⑤ 按「预计增量点击 = 月搜 × (目标名次点击率 − 现名次点击率)」排序；点击率曲线是平台默认假设，A/B 之后由 Tune 校准
S3 验证(闸门)      对排序前 K 个(默认 10)：实时 SERP 前 3 标题，**用 `getOrganicRanks`（`serp.ts`，未过滤 .gov/.org/.edu、不截断、固定 depth、回单带 `cost`），不用 `getSerpPage`**（后者会先滤掉政府/组织/教育站再取前 10，旅游目的地查询里这些页常在前三，用它会让页面类型比较建立在错误证据上）+ 「我们在排的是哪个网址」（S1 已带回，免费）
                   月搜 <100 的词 SERP 拉 2 次取一致（手册 §九）。任一项缺失 → 跳过并写原因，绝不按 0 或借别词兜底（CLAUDE.md §8 第 8 条）
S4 处方(Prescribe) 每个通过的词分到 4 类之一，生成「做什么页 / 改什么页」草稿（见 2.2）
S5 回执            每个阶段一条机器可读回执；PM 每周只看到 1 条汇总待办（见 2.3）
```

### 2.2 四类处方（草稿，不执行）

| 类型 | 触发 | 草稿内容 | 去向 |
|---|---|---|---|
| **改页** | 我们已排第 11–30，且排的页就是该词的合理落点 | 该页 URL、目标词、对手名次与对手页类型、建议标题/H1/内链调整方向 | 进现有每周自动改标题候选（过六道闸 + dry_run）；超出标题范围的改动进人工待办 |
| **补页** | 我们完全没排，买团/目的地意图，KD 在上限内，站内没有对应页 | 建议页类型（指南页/产品页/博客）、目标词、对手页 URL 作参照、不得抄袭 | **等 PM 点头**（新页面一律人工，手册 §四） |
| **合页/岔开** | 我们排的是博客、同主题指南页没排上（样例里 forbidden city、yangtze 都是这个形状） | 哪张当枢纽、哪张岔开、内链往哪汇 | **等 PM 点头**（动站点结构，手册 §八） |
| **观察/定时** | 纯信息词或有时间窗（如 2027-02-06 农历新年） | 词、时间窗、建议发布截止日 | 周报一行，PM 要做再升级 |

**更大胆的地方**（回应「SEO agent 太保守」）：①不再只看「我们没排」，主攻「已经排上但落后」——这类词已有页面、已有曝光，推一步最快；②处方直接给到「哪张页、改成什么方向」而不是一堆词表；③「改页」类可直接进已有自动通道，不用每周等人批（见问题 3）。

### 2.3 PM 看到什么

每周一条待办：「本周竞品词处方 N 条（改页 a / 补页 b / 合页 c / 观察 d），预计增量点击合计约 X」+ 直达链接到清单。每条处方三件套：**what**（问题和影响）· **how**（具体改哪页、怎么改）· **href**。批准只推进到下一事件，**不等于发布授权**。

### 2.4 工作流约束（CLAUDE.md §3 Inngest 硬约束）

事件：`seo.competitor_gap.due` → `seo.competitor_gap.scanned` → `seo.competitor_gap.prescribed`。每阶段回执带 request id、client id、source record id、status、cost（来自回单）、no_publish=true、created_at。花钱的步骤放 step 内，不重试（重试 = 重复扣费），防重复靠库里「本周已扫过就跳过」闸，不靠事件 id（沿用 `competitor-watch-weekly` 的做法）。**所有副作用 fail-closed：没有 PM 授权事件，不改网站、不发任何东西。**

## 3. 数据与花费

### 3.1 单价（实测）

回单里的 `cost`：两边都排 15–34 条 = US$0.0138–0.0161；对手排我们没排 100 条 = US$0.024。≈ US$0.01 + US$0.00014/条（见样例文件 §5）。实时 SERP：官方列表价约 US$0.002–0.006/次（**本窗口未实测，按上限 US$0.006 估**）。

### 3.2 每周每客户（CTS：6 个竞品、K=10）

| 项 | 次数/周 | 估价/次 | 每周 | 每月（×4.3） |
|---|---|---|---|---|
| A 两边都排 | 6 | ≤US$0.024（实测 0.014–0.016） | ≤US$0.144 | ≤US$0.62 |
| B 对手排我们没排 | 6 ÷ 4（每 4 周一轮） | US$0.024 | US$0.036 | US$0.14 |
| SERP 验证（`getOrganicRanks` depth 10，K=10，低量词拉 2 次） | ≤20 | ≤US$0.006 | ≤US$0.12 | ≤US$0.52 |
| 逐词测量（处方词名单 ≤20 个，`getOrganicRanks` depth 30，**按每词 ≤US$0.01 估，未实测**） | ≤20 | ≤US$0.01 | ≤US$0.20 | ≤US$0.87 |
| **合计** | | | **≤US$0.50** | **≤US$2.2** |

**样例已实测的是前两行（4 个竞品 8 次查询 = US$0.156）；SERP 行是按官方价估的，未实测。** CTS 预计每月约 US$2.2 上限（含逐词测量；实际多半 US$1.5 左右）。

### 3.3 与 US$15/月共用上限的关系

SEO 共用的其他消耗（每周关键词快照、基线域名、自动改标题的实时 SERP、AI 可见度等）**目前没有汇总数字**，所以我**不能证明合计不超 US$15**。本模块的 US$3 只是**内层子限额**，不能用来推导「共用 US$15 不会被突破」（别的任务已花 US$14 时，本模块自己的 US$3 仍会放行）。硬规则：
- **共用 US$15 必须由一个原子账本统一执行**：所有受该上限约束的付费调用（含现有每周快照、基线域名、meta cycle 的实时 SERP 等）先从同一个池预留、回单后结算。GEO 账本按 `(client_id, period_key)` 聚合，**不会自动计入其它 SEO 调用**，所以需要一个全局池键，而不是只给竞品模块加键。
- **取不到合计就拒绝付费调用**（fail-closed，不按 0 放行）。因此**周跑（S3）必须等共用账本就位才能开**，这是 S3 的前置条件。
- 本模块再自限**月度子限额 US$3**（占共用上限 20%）。CTS 单客户约 US$2.2，还留得出第二个客户的空间。
- **步骤 S0（见 §6）先定账本**：每次付费调用先预留、回单后按真实 `cost` 结算，才能开周跑。**优先复用 GEO 那套账本的机制**：能不加表就把竞品这块记在同一套账里（用独立的预算键区分）；若必须做成不带 `geo_` 前缀的通用账本，那是库结构变更（A 级，要 PM 点头），这是 S0 要先查清的事。没有账本不开周跑。

### 3.4 超限降级顺序（任何一步都不允许「降到 0 数据」或「没数据当通过」）

1. 本月用到线的 60%：SERP 验证 K 从 10 降到 5，且只对月搜 ≥100 的词拉 2 次。
2. 80%：B（我们没排）整轮暂停；A 的竞品数从 6 降到 3（按上周命中数排序）。
3. 100%：停止付费调用，只用上周缓存重排处方，回执写 `budget_stopped`，并下发一条人工待办（说明停在哪、差多少、要不要加线）。
4. 回单 `cost` 缺失（取不到真实花费）时按「列表价上限」入账，并在回执里标 `cost_estimated`。

### 3.5 信息完整闸门（照 CLAUDE.md §8 第 8 条，逐条对应）

| 闸门要求 | 本设计怎么满足 |
|---|---|
| 目标词有搜索量 + 难度（快照 ≤14 天或现场查） | domain_intersection 回单自带月搜；KD 随回单带回，缺则 `bulkKeywordVolume` 补；快照存 `fetched_at`，>14 天不进处方 |
| 已取实时 SERP 前 3 标题 | S3 `getOrganicRanks`（未过滤的真实前三，含政府/组织站，固定 depth） |
| 客户排名的 URL 就是这一页 | S1 回单 `second_domain_serp_element.url`，与处方指向页比对；不一致 → 判「合页/岔开」或跳过 |
| 词含该页主题词且为受众语言 | L4 主题集 + 英文词判定；非受众语言跳过 |
| 同一个词 90 天内未被别页用过 | 查 `content_strategy_items` 与 `seo_meta_log` 近 90 天，已用即跳过 |
| 新文案不与原文事实矛盾 | 本稿**不生成文案**，只给方向；真正改文案时由现有 meta cycle 的核对闸承接 |

## 4. 三层放置

| 层 | 放什么 | 放在哪 | 不许放什么 |
|---|---|---|---|
| **平台 L1**（竞品支柱 · SEO 场景） | 取数、名次对比、过滤管线、增量点击打分、四类处方结构、信息完整闸门、预算账本与降级、回执与事件、验证口径 | `src/lib/`：新增竞品词差距模块，**复用** `dataforseo/labs-competitors.ts`、`competitors/resolver.ts`、`seo-intelligence/keyword-relevance.ts`、`competitors-gap-cache.ts` 的缓存与「失败不入缓存」规则；`snapshot.ts` 的周快照并入或退役（见 §6 S1） | 任何客户名、客户域名、客户词、行业判断 |
| **行业 L2**（旅游，ME 旅游版） | 对手类型：①同市场直接对手（本地旅行社/团游运营商）②同目的地海外专线（如以目的地为主的运营商）③聚合平台（排除，如已有 `GENERIC_DOMAIN_BLOCKLIST` 里的 tripadvisor/booking 等）；词意图分级：**买团词**（目的地+tours/packages/from NZ）> **目的地指南词**（城市/景点名）> **实用信息词**（签证/最佳季节）> **节庆/文化信息词**（农历新年/生肖/龙，低转化，归观察）；噪音词表（沿用 `TRAVEL_NOISE_TOKENS`：航空/机场/护照/移民等） | Playbook / Profile 配置；手册 `playbook-competitor-industry-travel.md`（见下） | 单客户的产品清单、竞品名单 |
| **客户 L4**（CTS） | 竞品域名清单；主题集（CTS 卖什么：来自 `master_briefs` + `clients.primary_keywords` + 现有页面）；主市场 NZ(2554) 与兜底市场 AU(2036)；难度上限；保护页（沿用 `meta_cycle_protected_slugs`）；是否开启（`seo_config` 新键 `competitor_gap_enabled`） | `clients.seo_config` / `master_briefs` | 任何写进共享代码的字面量 |

**竞品清单来源铁律**：只能是①PM 确认过的名单，或②DataForSEO `competitors_domain` 返回的真实竞品（`getSerpCompetitors`，带域名交集证据）；每个域名记录来源与确认日期，**不凭空加**。CTS 当前 17 家来源为 FDE 手填/Brief，是否 PM 确认未知，见问题 1。

**换客户测试**：换成一个悉尼地产客户，共享代码里需要改什么？答：不改——地产的对手类型、意图分级、噪音词进地产 Playbook；买房词/搜盘词的主题集进该客户配置。若发现需要改共享代码，那说明某条判断偷偷写死了旅游语义，应下沉。

**手册放哪**：竞品支柱目前没有手册。实施第一步一并建两份（Claude 持久记忆里，不进仓库）：`playbook-competitor-general.md`（平台机制：位置对比比「没排」更值钱、原始差距九成噪音、预算降级顺序、竞品名单来源铁律）和 `playbook-competitor-industry-travel.md`（标「候选参考」，目前只有 CTS 单客户证据）。`MEMORY.md` 加一行指针。本窗口按「不实施」没有建。

## 5. 怎么验证有效（Check / Tune）

**尺子的选择依据**：CTS 流量小，页级点击率前后对比假动静率约 41%（手册 §十四），目标词名次稳得多（中位数周变动 0 位）。所以：

| 层 | 指标 | 口径 | 怎么判 |
|---|---|---|---|
| **主尺子** | 处方目标词的**名次** | 每条处方出具当天把「我们名次 / 对手名次 / 落点 URL」写进基线（S1 回单自带，免费）。**逐词测量（不依赖现有周快照）**：现有 `snapshotRankedKeywordsForClient` 只抓域名排名前 200 的词，没有可添加的追踪词名单，词一旦跌出前 200 就从快照里消失，只剩「幸存词」会污染判断。所以处方词进一份「逐词测量名单」，每周对每个词用 `getOrganicRanks` 固定 depth=30、NZ 2554、desktop、en 实测；没进前 30 记「未进前30」（`position` 为空的行写进 `keyword_snapshots`，表本来就允许空名次，不改库结构），**绝不让它缺行** | 名次移动 ≥3 位才算决策级信号（「未进前30」→进榜算 ≥3 位）；30/60/90/180 天对齐 73 号检查点 |
| **相对指标** | **差距收窄** = 我们名次 − 对手名次 | 逐词逐周 | 只要对手动了，绝对名次不变也能看出相对位置 |
| **次尺子** | 落点页的 GSC **单页**曝光/点击 | 28 天前后；只对前后两窗都 ≥500 曝光的页下结论；不拿整站涨跌邀功（手册 §七 关二） | 低于门槛只记背景，不下「有效/无效」 |
| **结果** | 自然搜索询盘 | 沿用 `docs/audits/2026-10-09-seo-organic-lead-attribution-feasibility.md` 的口径（本稿未重读，实施时核对） | 季度级看，不做周判断 |

**三态必须分开写**：没测成（取数失败、窗口缺天、中途撤回、两周内同页改两次）≠ 测出来没变化 ≠ 测出来有变化。

**前置关（手册 §七）**：处方必须有真实执行回执（`execution_item_id` / 变更记录）才允许进入打分，不给没发生的事打分。

**Tune**：记录每类处方的命中率（名次移动≥3 位的比例）与预计 vs 实测点击，用于校准点击率曲线与难度上限；**累计 ≥10 条有完整测量的处方之前，不写入经验库**（经验库里的 SEO 经验目前是噪音，手册 §七 关三）。

## 6. 分几步做、风险级、要不要 PM 点头

| 步 | 内容 | 风险 | PM 点头？ |
|---|---|---|---|
| S0 | 设计稿定稿 + 子牙/魏征两审；定账本方案（复用 GEO 预留/结算机制；通用化要改库结构则升 A 级）；核实 `content_strategy_items` 能否承载竞品证据 | C（文档）；账本若动库则 A | 账本若要动库：是；其余否 |
| S1 | 位置对比取数函数（复用 labs-competitors 封装，新增 intersections=true 路径）+ 过滤管线 + 打分，纯函数 + 假数据测试（样例文件做夹具，客户名脱敏）；`competitor-watch-weekly` 的去留一并决定 | B | 否 |
| S2 | 信息完整闸门 + 四类处方生成，只出 dry_run 草稿，对 CTS 当场试跑一次并自行核对结果（CLAUDE.md「当场试跑」） | B | 否（自己跑 dry_run 验证；新页/合页类仍人工点头） |
| S3 | 处方写入 + 每周一条 PM 待办 + 事件/回执（Inngest） | B（若动今日待办规则则升 A） | 否（在 US$15 内）；超限才是 |
| S4 | 「改页」类喂现有自动改标题通道；基线记录与每周名次对账 | B | 否（§7 第 3 条已定） |
| S5 | Check/Tune 报表；手册两份；逐词测量名单（含 `guilin` / `silk road`） | C–B | 否 |
| 之后 | 第二个客户、行业 L2 Playbook 抽象；有第二个同行业客户证据后手册才升格 | — | 是（新客户开关） |

CTS 是首个客户；所有 CTS 特定内容只进配置与客户目录。

## 7. 已自行拍板的事项（PM 2026-10-14 新规：简单事不审、只有涉及钱超限或 P0 才找 PM）

1. **竞品名单**：先只盯 4 家实测有数据的——Wendy Wu NZ、Explore Worldwide、World Journeys、China Highlights；另 2 个位置留给「DataForSEO 查出的真实对手」，加入前先在回执里列证据。名单来自 CTS 库里现有竞品名单，在有 PM 反对前沿用。
2. **花费线**：竞品模块每月自限 US$3，在 PM 已批的 SEO 共用 US$15 之内（CTS 预计约 US$2.2），到线按 §3.4 自动降级。**只有当合计将超 US$15 才找 PM。**
3. **改页类处方**：已有页的标题/描述类处方进现有每周自动改标题通道（仍过六道闸、仍先 dry_run、保护页不动），与已有授权口径一致；新页面、新文章、合并页仍走人工点头（属对外发布/改站点结构，规则未放宽）。

**仍需 PM 的只有**：账本若必须做成通用表（改库结构，A 级写生产库）；任何一次会让合计超 US$15 的花费。

## 8. 风险与没验证的

- 样例是单日、单市场（NZ）、DataForSEO 口径；与 GSC 平均名次口径不同，不能直接比较（73 号 §3）。
- 点击率曲线是通用假设，不是 CTS 实测；机会数字只用来排序。
- 低量词 SERP 不稳（手册 §九）：这是 S3 拉 2 次的原因，也意味着单周名次变动 <3 位不当信号。
- DataForSEO 对 NZ 小市场覆盖有限：2 家竞品关键词数为 0，是真的没排还是没收录，未验证。
- 逐词测量与 SERP 单价均为估算未实测；「SEO 共用 US$15」的合计账本不存在，US$15 合计未能核对；SERP 单价未实测。
- `content_strategy_items` 能否承载本设计的证据字段、`status` 取值，未核实；若不能，需要加表（A 级迁移，需 PM 同意），这是 §6 S0 要先查清的原因。

## 9. Reuse Statement

- **复用**：`dataforseo/labs-competitors.ts`、`labs.ts`、`serp.ts`、`competitors/resolver.ts`、`seo-intelligence/{keyword-relevance,competitors-gap-cache,intent-strategy,keyword-opportunity}`、`seo-meta/cycle` 闸门、`keyword_snapshots`、Inngest 周跑骨架。
- **平台共享新增（拟）**：位置对比取数、过滤/打分管线、四类处方结构、预算（复用 GEO 账本机制）。**行业**：旅游对手类型、意图分级、噪音词（沿用现有 `TRAVEL_NOISE_TOKENS`）。**客户**：CTS 竞品名单、主题集、难度上限、开关。
- **客户名/ID 进 shared runtime？** 无；本稿的 CTS 内容仅在样例文件与 §7。
- **学习边界**：本轮发现（原始差距九成噪音、「排得更后」比「没排」更值）暂记在本稿，手册建好后进 L1 通用；旅游意图分级先进 L2「候选参考」；CTS 具体词与名次仅留在客户私有。
- **与 tier-gate 决策时的分类是否一致**：一致（竞品支柱下的 SEO 场景，复用 L3 DataForSEO 封装；不新增支柱/能力线）。
