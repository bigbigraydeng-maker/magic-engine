# Commerce 选品结果落库 v1 —— 表设计

> **v2（2026-08-16）** —— 已过子牙（架构）+ 魏征（挑刺）双审并按意见修订。
> 状态：**设计定稿，未实现、未 apply**。A 级风险（加表 + migration）。
> 实施完按铁律 4 还要再审一次，且需魏征再挑一刀。
>
> 实验主体 = Jingshop `71b5ec11-3abc-4ae8-9ea2-563219228f3a`（2026-08-16 建档，`prospect`）。

## 0. 双审结论与 PM 决策

| 来源 | 结论 |
|---|---|
| 子牙（架构） | 有条件通过 —— 3 结构缺陷 + 6 必改 + 3 上游事实 |
| 魏征（挑刺） | 打回 —— 6 条阻止项 |

**PM 2026-08-16 拍板两件（都是范围决定）：**
1. **趋势要做** → 新增第四张表 `commerce_watchlist` + 给 TikTok 采集器加「按 ID 回采」
2. **Trade Me 采集器先建，再建表** → 表一上线就能真的产出 `TEST_NOW`

---

## 1. 要解决什么

`src/lib/commerce/product-intel/` 已能跑通「发现 → 验证 → 测算 → 判定」，但**一行数据都不写**，跑完就没。

1. **趋势** —— 同一商品的时间序列。TikTok / 1688 都不给历史（已实测），自己按天存是唯一的路。
   > 🔴 **光靠关键词扫描交付不了这一条**（子牙 B1）：品跌出榜单就不再产生快照，
   > 于是「在涨」和「还在榜上」变成同一件事，**结构上不可能显示出下跌**。
   > 必须配 `commerce_watchlist` + 按 ID 回采。这是本次新增第四张表的唯一理由。
2. **判定可复现** —— 汇率每天变、运费按季度变。假设不留档，三个月后重算得出不同答案。
3. **接上管道** —— 回流 / 记忆 / 今日待办都要 `client_id` + 可引用实体。

## 2. 设计原则（照抄既有判决，不重新发明）

| 原则 | 判例 | 落法 |
|---|---|---|
| 观测不可变 | GEO 存储 v1 `:789-834` 的 `geo_immutable_row` | snapshots / verdicts 全冻结触发器 |
| **TRUNCATE 必须单独挡** | 同上 `:563-565`（行级触发器在 TRUNCATE 上不触发） | 四张表全挂 `forbid_truncate` |
| 派生值不落库 | 同上（落库就要更新，更新违反不可变） | 毛利/ROAS/需要转化率都不存 |
| **失败也是观测** | 同上 `:305`（不落行会让「问了但失败了」和「根本没问」长得一样） | `scan_runs` 终态插入含 `failed` |
| **不给 `DEFAULT '[]'`** | 同上 `:522-524`（空数组是有内容的结论） | `evidence_refs` 无默认值 |
| **CHECK 在 NULL 时放行** | 同上 `:210-213` | 所有 jsonb 形状 CHECK 套 `COALESCE` |
| `client_id` NO ACTION 不 CASCADE | 同上（附 client_assets 真实事故） | 四张表一致 |
| 金额三段式 CHECK | Kernel `:464-468`（PG 17.6 实测 `'NaN' >= 0` 为 true） | `estimated_spend_usd` |
| 复合外键不双写 REFERENCES | Kernel `:288-292`（删除成败取决于约束 OID） | verdicts 只写复合 FK |
| RLS 必 `FOR ALL TO service_role` | DECISIONS / 2026-08-03 泄露 118 条 | 四张表逐张写全 |

**反面教材（子牙 Q5，必须写进来）**：`competitor_snapshots` 跟本设计几乎同构，
但它**只存前 50 条摘要、无不可变约束、无 provenance** —— 结果今天想拿它做趋势做不了。
仓库里已经有过一次答案，这次别再来。

> ⚠️ **不要照抄 `20260517000001_flywheel_data_skeleton.sql` 的 RLS 写法** ——
> 那三条策略源码缺 `TO service_role`（生产已被 `20260803020000` 收紧，非活的泄露，
> 但源码是错误模板）。一律照 GEO / Kernel。

---

## 3. 四张表

### 3.1 `commerce_scan_runs` —— 一次扫描（**终态插入**）

🔴 **不许「先插后更」**（子牙 B3 / 魏征 6）：跑完或跑挂之后一次插入，照 `geo_batches` `:159-166`。
否则挂上不可变触发器后第一次 `UPDATE ... SET finished_at` 就炸。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid NOT NULL REFERENCES clients(id) | **NO ACTION** |
| `seed_keywords` | text[] NOT NULL | `CHECK (array_length(...,1) >= 1 AND NOT (seed_keywords @> ARRAY[NULL::text]))` |
| `status` | text NOT NULL | `CHECK IN ('completed','partial','failed')` —— **失败也落行** |
| `planned_coverage` / `actual_coverage` | jsonb NOT NULL | `{keywords[], providers[], attempted, succeeded, failed}`；形状 CHECK 套 COALESCE |
| `cost_assumptions` | jsonb NOT NULL | `CostAssumptions` 全量 + `asOf`；CHECK 要求 `asOf` 键存在 |
| `assumptions_version` | text NOT NULL | 契约版本（字段增删时 +1） |
| `started_at` / `finished_at` | timestamptz NOT NULL | 插入时都已知 |
| `triggered_by` | text NOT NULL | `CHECK IN ('human','schedule','agent','run','replay')` |
| `estimated_spend_usd` | numeric | 🔴 **改名**：`commerce-poc.ts:125` 是硬编码单价估算，不是实际花费。三段式 CHECK |

索引：`UNIQUE (client_id, id)`（复合外键落点）

### 3.2 `commerce_product_snapshots` —— 商品时点观测（**核心表，永不更新**）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `scan_run_id` / `client_id` | uuid NOT NULL | 复合 FK `(client_id, scan_run_id)` |
| `seed_keyword` | text NOT NULL | 🔴 **新增**（魏征 3）：需求量是**按种子词**测的（`validate-aunz.ts` 文件头）。缺它则「这个候选的搜索量对应哪个词」永久不可回答。**写入方必须一次一个词调 actor** |
| `discovery_provider` | text NOT NULL | 🔴 **改名**（子牙 B2）：只表示**发现来源**。`COMMENT` 写死：任何观测值的来源**只能**读 `observations.<key>.source` |
| `source_product_id` / `source_url` / `title` | text NOT NULL | |
| `observations` | jsonb NOT NULL | 全部 `Measured<T>` 原样落 |
| `evidence_refs` | jsonb NOT NULL | 🔴 **无 DEFAULT**。且要能装**非 Apify 来源**（DataForSEO 无 run 指针，子牙 F2） |
| `actor_id` | text NOT NULL | 🔴 新增（魏征 10）：actor 换了输出语义，历史比较会静默作废 |
| `actor_build` | text | 同上；取不到落 unknown_reason |
| `normalize_version` | text NOT NULL | 🔴 新增：`normalize.ts` 的映射改了，`rules_version` 不该动，于是没有任何版本号会动 |
| `observations_version` | text NOT NULL | 🔴 新增：键集在快速变形（本周已加三项） |
| `observed_at` | timestamptz NOT NULL | 回放模式用 fixture 的时间，**不是 `now()`** |

- 唯一：`(scan_run_id, discovery_provider, seed_keyword, source_product_id)`
- 时间序列索引：`(client_id, discovery_provider, source_product_id, observed_at DESC)`
- 复合外键落点：`UNIQUE (client_id, id)`

**`observations` 的形状 CHECK（子牙 M2，缺了 §2 原则就不可强制）**
- `jsonb_typeof(observations) = 'object'`
- 9 个必需键各写 `COALESCE(jsonb_typeof(observations->'<key>'),'') = 'object'`
  —— **COALESCE 一个都不能省**
- `IMMUTABLE` 函数 `commerce_is_measured(jsonb)` 校验 `value/provenance/source/collectedAt/unknownReason` 五键齐全
- `provenance` 三值做成 **DOMAIN**（照 `geo_unknown_reason` `:31-34`）

**新增 DOMAIN `commerce_unknown_reason`（魏征 2）** —— 值域至少：
`provider_error` / `not_returned_by_source` / `not_attempted` / `not_applicable`
`Measured<T>` 契约加 `unknownReason`，规定 `value === null` 时必须非空。
🔴 **没有这个词汇表，「未富化」「富化失败」「真的没有」三者不可区分**，本设计其余修复全落不了地。

### 3.3 `commerce_verdicts` —— 判定（**永不更新**）

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `snapshot_id` / `client_id` | uuid NOT NULL | 复合 FK `(client_id, snapshot_id)`；**列上不再单独写 REFERENCES** |
| `verdict` | text NOT NULL | `CHECK IN ('TEST_NOW','WATCH','REJECT','UNKNOWN')` |
| `gates` | jsonb NOT NULL | `CHECK jsonb_typeof = 'array'`；逐闸门 `{gate, outcome, reason}` |
| `assumptions_snapshot` | jsonb NOT NULL | 🔴 新增（魏征 4）：**连 `asOf` 一起存，不是指回 scan_run**。否则换汇率重判旧快照会键撞车，且看不出用的哪套假设 |
| `assumptions_fingerprint` | text NOT NULL | generated column，`assumptions_snapshot` 的哈希 |
| `rules_version` | text NOT NULL | 由五个门槛常量**哈希算出**，不靠人自觉（子牙 Q3；判例：Kernel 让数据库自己 +1 `policy_version`） |
| `rules_snapshot` | jsonb NOT NULL | 当次生效的门槛逐字落库，免得三个月后要去 git 考古 |
| `engine_version` | text NOT NULL | 🔴 拆出（子牙 Q3）：`rules_version` 管门槛，这个管算法代码（`landed-cost` / `ad-economics` / `score` 的语义版本） |
| `decided_at` | timestamptz NOT NULL DEFAULT now() | |

唯一：`(snapshot_id, rules_version, assumptions_fingerprint, engine_version)`

> ❌ **删掉 `evidence_rank`**（魏征 8）：纯派生值，违反 §2 原则 2。
> 每天几百行，`ORDER BY` 现算不值钱。

配套新表 `commerce_rules_versions (version PK, thresholds jsonb, engine_version, frozen_at)`
带不可变触发器 —— 改了门槛却复用旧版本号会**当场撞唯一约束**，而不是静默产出不可比的判定。

### 3.4 `commerce_watchlist` —— 盯盘名单（**PM 2026-08-16 决定新增**）

解决 B1：跌出榜单的品也要继续产生快照。

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid NOT NULL | NO ACTION |
| `discovery_provider` / `source_product_id` | text NOT NULL | 回采身份 |
| `added_at` | timestamptz NOT NULL | |
| `added_reason` | text NOT NULL | 为什么盯它（verdict / 人工） |
| `source_verdict_id` | uuid | 引用触发入盯的判定 |
| `dropped_at` / `dropped_reason` | timestamptz / text | **软下架，不删行** |

唯一：`(client_id, discovery_provider, source_product_id) WHERE dropped_at IS NULL`

> 🔴 **这张表不是不可变的**（`dropped_at` 要写）—— 唯一一张允许 UPDATE 的。
> 用白名单守卫（照 `geo_query_sets_guard`）只放行 `dropped_at` / `dropped_reason`。

**前置**：`src/lib/apify/tiktok-shop.ts` 目前只支持 `mode:'shop_search'`，
**必须先加按 id / URL 取详情的能力**，否则这张表没有消费方。

---

## 4. 刻意不建

- ❌ 聚合指标表（毛利/平衡 CAC/需要转化率）—— 从快照 + 假设算
- ❌ 供应商 / 商品主数据表 —— 没有可靠的跨 provider 归一标识
- ❌ `commerce_gate_results` 一行一闸 —— 五道闸是一次判定的完整表达，拆开后「少一行」和「那道闸没跑」长得一样
- ❌ 投放实验表 —— 属 Kernel 治权
- ❌ 复用 `flywheel_metrics` —— `metric_value NUMERIC **NOT NULL**`，**表达不了「取不到」**，而 null vs 0 是本契约第一条红线

## 5. 已知的能力缺口（必须写明，不许留成惊喜）

🔴 **在 Trade Me 采集器落地前，`verdict` 结构上不可能出现 `TEST_NOW`**（子牙 F2）：
`sources/` 是空目录，`withLocalMarket` 只有测试在调 → `localMarket` 恒 null →
毛利闸永远走 `coarseScreen` → 按设计**永不返回 PASS** → `decideVerdict` 要求全 PASS。

**PM 已决定先建采集器再建表**，所以这一条在 PR-B 上线时应已消解。
若顺序变更，此段必须保留在设计稿里 —— 否则会做出一个永远是 0 的「今天有 N 个可测」栏位。

🔴 **`evidence_refs` 的 `datasetId` / `actorId` 现在的代码产不出来**（子牙 F1 / 魏征 1）：
`runActorAndGetResults` 只透出 `runId`（`client.ts:115`），`defaultDatasetId` 用完就丢。
→ PR-A 顺手改 `ApifyRunResult` 带出 `defaultDatasetId`。

🔴 **Apify dataset 保留期**：未命名 dataset 免费版 7 天 / 付费版 31 天，命名的才无限期（已查证官方文档）。
判决取子牙的：**`evidence_refs` 保留** —— 它回答「当时是哪次 run」，这个语义永不过期；
但它**不能当唯一的原始数据留存手段**。PR-C 开工前二选一：采集时给 dataset 命名
（`commerce-<scan_run_id>-<provider>`），或落原始 payload。**不阻塞建表。**

## 6. 上线顺序（按 PM 决策重排）

| PR | 内容 | 级别 |
|---|---|---|
| **A** | Trade Me 采集器 + 重量采集 + TikTok 按 ID 回采 + `ApifyRunResult` 带出 datasetId + **修 `validate-aunz.ts` 的 provenance 撒谎** | B |
| **B** | 四张表 migration（**只建表**，不写入、不接调用方、不建 cron）+ 末尾 `NOTIFY pgrst, 'reload schema';` + 自验 SQL 块 | **A** |
| **C** | 写入路径接进 `scripts/commerce-poc.ts` | B |
| **C.5** | 🔴 只读视图/脚本，人眼过一遍时间序列与完整 gates（子牙 Q6）—— **快照不可变，形状写错的行永远修不掉**，不能等 cron 才发现 | C |
| **D** | 每日 cron + 今日待办 | B |

- `apply_migration` 需 PM 显式 `go`，**不是合并 PR 的副产品**
- **PR1 验收只认对象存在性**：`to_regclass` 四表 + `pg_policy` 逐表确认 `TO service_role` + `pg_trigger` 确认不可变与 forbid_truncate 都在。账本版本号是 Supabase 重新生成的，文件名不是 apply 证据

🔴 **写死一条禁令（子牙 Q5）**：PR-D 的「`TEST_NOW` → 投 NZ$200 测试」
**不许往 `execution_items` 插行**（ADR-001：那是人看的意图卡不是执行引擎，
`boundaries.ts:85-101` 的 15 个直写生产者**只准变短**），必须提交 `action_run`
（`purpose='growth'`，`evidence` 带 snapshot_id + verdict_id）。

## 7. 「将来再提列」的可判定触发条件（子牙 Q2）

`observations` 用 jsonb 是务实选择，但**代价由 §3.2 那组 CHECK 买单**。
提列的触发条件写死，否则「将来再说」永远不会到来：

> 当某个观测值出现在 `WHERE` / `ORDER BY` 里，**或**单表超 100 万行 —— 才提列建索引。
