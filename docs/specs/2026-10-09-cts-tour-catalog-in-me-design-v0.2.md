# ME Tour Catalog（团目录）· CTS 首例 · 设计稿 v0.2

**日期**：2026-10-09　**状态**：v0.2（已吸收子牙 + 魏征首轮复审：两人均判「修订后再审」），**待复审，未授权实施**
**来源**：PM 2026-10-09 拍板「团信息源头放 ME」（ledger：`2026-10-09-cts-tour-management-source-in-me`）+ 同日补充：客户（CTS）会自己开发独立下单系统，ME 统一管理产品，网页/广告/社媒/邮件读 ME，ME 与下单系统以 CSV 导入导出同步。
**承接**：[2026-09-14 Tour 管理模块规划](./2026-09-14-me-tour-management-module-plan.md) 的 P1（统一事实源）。**与该规划的差异见 §1。**

v0.1 → v0.2 主要改动：公开口 P1a 不上线；定义日期展示串与匹配规则；补别名表、导入幂等与回滚冲突规则、价格格式校验、整团售罄规则；补漏掉的事实源；砍掉 P1a 的编辑页与 v2 自动拉取。

---

## 0. 一句话

在 ME 里建一份 **「对外展示的团目录」**（团 + 出发日期 + 展示价 + 状态快照），作为 CTS 所有渠道的唯一来源；网站、表单、广告、社媒、邮件、客服机器人最终都读它；与客户将来的下单系统用 CSV 对接。**不存订单、不存正式报价、不存付款、不存座位数。**

## 1. 与 9-14 规划 / 产品定义的关系（**需 PM 确认**）

- `ME_PRODUCT_DEFINITION.md` §3.2：旅游库存、正式报价、出票和预订后台不由 ME 自建；§3.3：ME 可存「必要营销上下文 + 授权快照」。
- 9-14 规划据此写了「不新建 ME 自有团数据库，只做 Connect」，前提是存在一个外部事实源可连。
- 现实变了：CTS **没有任何团管理系统**，唯一的「源」是 `chinatravel` 仓 `src/lib/data/tours.ts`（代码）；下单系统尚未存在。
- **本稿边界**：ME 持有**营销展示层团目录**（营销事实的权威源）。班期 `status`（open/limited/sold_out/closed/cancelled）明确定性为 **§3.3 允许的「授权快照」**——来自人工或下单系统导出的 CSV，用于营销决策（售罄不投广告），**不是库存**；**不存剩余座位数、订单、付款、正式报价单**。交易事实永远留在客户的下单系统。
- **PM 已于 2026-10-09 在对话中明确同意本边界。** 待办：在 `ME_PRODUCT_DEFINITION.md` §3.2 补一句口径（A 级文件，另开 PR、问 PM 后才合）；复审后方可进入实现。

## 2. 现状盘点（只读调查，2026-10-09；复审后补全）

团信息（名字/价格/班期/在售状态）现在散在 **至少 9 处**，互相不同步：

| # | 位置 | 内容 | 谁读 / 备注 |
|---|---|---|---|
| 1 | `chinatravel` 仓 `src/lib/data/tours.ts`（约 3000 行，36 条） | 官网团数据 | 官网所有页面 |
| 2 | 官网读取口 `https://www.ctstours.co.nz/api/internal/tours`（读 #1 再吐出，33 个团） | `FirstPartyTour` 形状 | ME `first-party-tours.ts` → web-intelligence、`cts-tour-price.ts` |
| 3 | `factory_config.render.creatomate.offers` + `verified_offer` / `verified_cta` | 视频工厂用的团/档位/手填价格 | 视频工厂 |
| 4 | `config/clients/cts/offerings.yaml`（206 行，手工，头注自称待 PM/FDE 审） | 在售团 | 私信 Agent 工具/Verifier（`knowledge-fact-expiring-items.ts` 注释称生产无调用，P2 核实） |
| 5 | 生产库 `group_tours`（17 列，**1 行**：状态 published、`China Discovery — Golden China`、含 price、来源 docx、PR #139、2026-08-24） | draft→PR 流程 | `cts-tour-price.ts` **第 1 优先**，会压过任何新目录 |
| 6 | `master_briefs.products` | 品牌 brief 里的产品 | `web-intelligence/service.ts:52-54` **优先级高于官网 feed** |
| 7 | `client_knowledge_facts`（CTS 价格类 4 条） | 私信链路读 | 审计 `2026-10-05-channel-client-facts-sources.md` |
| 8 | `market_snapshots` 的官网抓取（`service.ts:50`） | 抓取副本 | web-intelligence |
| 9 | PM 提供的《2027 年出团信息汇总》表 | 班期 + 航司/航段/人数 | 目前只在 PM 手里 |

**实证漂移**：该表里多个团的出发日比官网多：Best of China 表 4 个 vs 官网 2 个；A Tale of Two Cities 表 6 个 vs 官网 2 个（初稿误写 5，已按截图逐行重数更正）；Natural China 表 6 个 vs 官网 1 个；Shanghai & Surroundings 表 3 个 vs 官网 1 个；China Legacy 表 2 个 vs 官网 2027 年 1 个；Silk Road、China Panorama 两边一致。逐班期对比见 `docs/clients/cts/2026-10-09-2027-departures-vs-website.md`（截图下沿在 2027-11-14 被截断，之后班期未计入）。**另发现官网有两个 Natural China 条目**（Signature 与 Discovery），表中未标档位。
> 不能断言官网「错」：多出的可能是尚未对外放出的班期。**需 CTS 确认哪些班期现在就该对外**（§9 问题 1）。

**表的列**：出团日期 / 行程名称 / 航空公司 / 人数(20) / 去程航段 / 返程日期 / 返程航段。航司、航段、人数是运营信息，非公开展示用。

## 3. 层级判定（me-platform-tier-gate）

- 整体 = **L2 旅游版能力**（ME 旅游版，registry 已立版）：换另一家旅行社可用，换地产/电商无意义。
- CTS 的具体团/价格/班期 = **L4 客户数据**：表带 `client_id`，不进 shared runtime 代码；shared 代码里不出现 CTS 名/ID。
- 对外遵守：不出现供应商真名；价格用「From NZD $X」展示写法。

## 4. 数据模型（提案）

> 新表一律 RLS：`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ... FOR ALL TO service_role USING (true) WITH CHECK (true)`；禁止 `auth.uid()`/`workspace_id`。

**`tour_catalog_tours`**（一个团一行，按 client 隔离）
`id` · `client_id fk clients` · `slug` · `destination` · `tier` · `name` · `title` · `short_description` · `duration_text text`（如 "10 days"，**保持官网契约的字符串**，`durationDays` 解析依赖其中数字）· `display_price_text text`（展示串，写入时必须通过 §6.4 校验）· `highlights/itinerary/inclusions/exclusions/tour_cities jsonb`（沿用 `FirstPartyTour` 形状）· `single_supplement` · `max_group_size` · `is_active bool` · `sort_order` · `created_at/updated_at`。
约束：`UNIQUE (client_id, destination, tier, slug)`（slug 单独会重名，官网已有两个 `highlights`：`tours.ts:2530` 日本、`:2724` 越南）。

**`tour_catalog_aliases`**（CSV 名 → 团 的显式映射，解决匹配键问题）
`client_id` · `alias_norm text`（规范化：trim、小写、折叠空白、`&`↔`and`、去 `—` 前缀的档位词后另存一条）· `tour_id`；`UNIQUE (client_id, alias_norm)`。
导入匹配顺序：①别名表精确命中 → ②与团 `name`/`title`/去前缀短名的规范化精确命中 → **命中 0 个或 ≥2 个一律拒收该行并列出**，由 PM 在预览页补一条别名后重跑。**不做模糊匹配**。

**`tour_catalog_departures`**（一个班期一行）
`id` · `tour_id fk` · `client_id` · `depart_on date`（**纯日历日，无时区**）· `return_on date null` · `price_text_override text null`（通过同一价格校验）· `status text check in ('open','limited','sold_out','closed','cancelled')` · `status_source`（'manual'|'csv:<批次id>'）· `status_as_of` · `internal jsonb`（航司/航段/人数上限等运营信息，**永不进任何对外输出**）· `created_at/updated_at`。
约束：`UNIQUE (tour_id, depart_on)`。

**`tour_catalog_import_batches`**（每次导入一行，审计 + 回滚）
`id` · `client_id` · `kind ('departures'|'status')` · `file_sha256` · `row_counts jsonb` · `before jsonb`（受影响行的导入前快照）· `after jsonb`（导入后快照）· `status ('previewed'|'applied'|'rolled_back'|'rejected')` · `applied_by` · `created_at`；`UNIQUE (client_id, kind, file_sha256)`。

**不新建**：价格计算、座位、订单、付款、报价单。回滚粒度只用批次 `before/after`，不再另设行级 `version`。

## 5. 输出契约（消费者零改动的前提，复审补全）

- **输出形状 = `FirstPartyTour`**（`first-party-tours.ts`）。ME 提供内部函数 `loadCatalogProducts(clientId)` 直接从库返回同形状数据；**P1a 不开放任何 HTTP 公开口**。
- **日期展示串规则**：`depart_on` → `"D Month YYYY"`（英文月份全称、日不补零，例 `13 May 2027`），与官网 `departureDates` 完全一致；`departure_pricing` 的 key 必须逐字等于这些展示串（官网契约：`tours.ts:34`）。
- **班期过滤**：`depart_on` 早于今天的不输出；`sold_out/closed/cancelled` 不输出；`open/limited` 输出。
- **整团可售规则**：输出的 `is_active = tour.is_active AND (该团无班期管理 OR 至少一个未过期且 open/limited 的班期)`。全部班期售罄/过期 → 整团不可售（避免广告继续推）。无班期管理的团（如 Stopover 系列）按 `is_active` 原样。
- **字段回退不变**：`name`/`title` 照原样输出（`firstPartyTourProducts` 取 `title || name`，`first-party-tours.ts:105`）；`duration` 输出 `duration_text`。
- **契约测试**：用现网读取口的真实 33 个团做 golden——ME 目录种子化后，`firstPartyTourProducts()` 的输出与现网逐字段一致（P1a 验收条件之一）。
- **P1b 才开 HTTP 口**：`GET /api/public/tour-catalog/<client-slug>`，需 per-client 只读 bearer token（官网服务器端携带）、`Cache-Control`、限流；`loadFirstPartyTourProducts` 增加可选 token。该口只返回上述输出，不含 `internal`。

## 6. 与下单系统的 CSV 同步（对端系统尚不存在）

### 6.1 范围
v1 = **人工上传 + 预览 diff + 人工点应用 + 可回滚**。**不做**定时拉取与阈值确认（对端不存在，属过度设计；待对端上线再另出设计）。

### 6.2 文件
① 班期导入（形如 PM 的汇总表）；② 状态导入（下单系统导出的班期可售状态）；③ 目录导出（团名/班期/展示价，供对账）。
CSV 日期只接受 `YYYY-MM-DD`，其它格式整行拒收。

### 6.3 导入规则（幂等与安全）
- **只增改，不删**：CSV 里没有的班期不动；要下线某班期必须显式把 `status` 置 `cancelled`/`closed`。
- 同一文件（`file_sha256`）同 `kind` 重复上传 → 直接拒收并指向原批次。
- 单文件大小上限（2 MB）、行数上限（2000）；单元格以 `= + - @` 开头的文本在**导出**时加前缀 `'` 防公式注入；导入时同样拒收可疑单元格。
- 预览必须列出：新增/改动/不变/拒收；**与官网现值冲突的行高亮**；任何一行无法匹配团、日期非法、返程早于出发、残缺值（如 `540+T`、返程为空且非允许）→ 拒收并报告，不猜。
- **权限**：上传可由 FDE/PM，「应用」「回滚」仅 PM/管理员（后台既有 admin 鉴权）；视为 A 级操作，写批次回执。
- **回滚**：仅当受影响行当前状态仍等于该批次 `after` 时才恢复到 `before`；有任何后续手改 → 拒绝回滚并列出冲突行，不覆盖手改。

### 6.4 价格展示串校验
写入 `display_price_text` / `price_text_override` 时，用 `cts-tour-price.ts` 的 `parsePriceDisplayString` 同款解析：必须解析出**单一**币种和金额，且文本中不得同时出现多个币种；解析失败 → 拒收，由 PM 修成「From NZD $X per person」类标准写法。（防止 `From AUD 5,200 (NZD $4,999 …)` 被误读。）

## 7. 分步计划

| 步 | 内容 | 风险级 | 说明 |
|---|---|---|---|
| **P0** | 只读差异报告：PM 2027 表 vs 官网读取口，输出差异清单给 CTS 确认（不碰库、不建表） | C | 直接回答 §9 问题 1；**建议先做** |
| **P1a** | 四张表 + 种子（现网 33 团）+ 班期 CSV 导入/预览/应用/回滚 + 只读后台列表 + 差异页；内部函数 `loadCatalogProducts`；**无 HTTP 口、不改官网、无渠道消费** | **A**（新表迁移） | 目录此阶段标注「未对账草稿」，不被任何渠道使用 |
| P1a-2 | 后台编辑页 | B | 从 P1a 拆出，视需要再做 |
| P1b | 官网读 ME：`chinatravel` 仓另开 PR；**切换闸 = 官网 vs ME 全量 diff 为零**；开 §5 的 HTTP 口；构建期拉取 + 运行期 ISR；**回退 = 构建时落盘的最近一次成功快照**，并要求 feed 带单调递增 `catalog_version`，站点拒绝应用低于已服务版本的 feed（防旧快照覆盖新数据）；切换后禁止回写官网仓 | A（动已上线官网） | 需 PM 授权上线 |
| P1c | `/traveller-details` 团/日期下拉改读目录 | B | 与 P1b 同批 |
| P2 | 收敛第 3–8 处：让 `cts-tour-price.ts` **先读目录**（压过 `group_tours`）、`master_briefs.products`/`client_knowledge_facts`/`factory_config` 引用目录；`offerings.yaml`、`group_tours` 退役 | A/B | `service.ts:52-54` 的优先级链要在此处理 |
| P3 | 广告/社媒/邮件读目录；售罄班期自动排除；状态 CSV 读回 | B | 对接 IMPACT |

**Inngest**：「发布到官网」是客户可见副作用 → 事件 `tour_catalog.publish.requested`（仅人工点发布触发）→ 函数调官网既有 `/api/revalidate`（需 secret）→ 写回执（request id、client id、批次/catalog_version、结果、时间）；失败可见（后台显示「已发布但官网未生效」）。无人工发布事件则不得自动改官网（fail-closed）。CSV 应用本身不触发官网变化。

## 8. 当场试跑计划（P1a 交付前）

1. 用 PM 的 2027 表（脱敏拷贝）上传 → 预览显示「表 vs 官网」差异行 → 应用 → 内部函数输出通过 `parseFirstPartyTourFeed`，`firstPartyTourProducts()` 对种子团与现网逐字段一致 → `lookupTourPrice` 对目录团可查。
2. **负面用例（必须真跑）**：重名团（两个 `highlights`）→ 行被拒；`540+T`/返程为空 → 拒收；重复上传同文件 → 拒收；以 `=` 开头的单元格 → 拒收；CSV 缺班期 → 库内班期不被删；应用后手改一行再回滚 → 回滚被拒并列冲突；回滚无冲突批次 → 数据恢复。
3. 全程不碰官网、不外发。

## 9. 待确认 / 开放问题

1. **哪些班期现在就对外？**（表里比官网多的班期）—— 问 CTS，PM 决策。
2. 表里 China Legacy 个别行返程日期空、航段列出现 `540+T`——按拒收处理，需 CTS 补正。
3. 「人数 20」是人数上限还是已订人数？影响是否进 `internal`。
4. 各班期是否有独立展示价？（官网有 `departurePricing`；表中无价格列）
5. `group_tours` 那 1 行（Golden China，已发布，PR #139）的去留：它现在压过其它来源；P2 处理。
6. **PM：§1 边界是否同意 + 是否更新 `ME_PRODUCT_DEFINITION.md` §3.2。**

## 10. Reuse Statement（预填）

- 复用：`FirstPartyTour` 契约与解析器、`parsePriceDisplayString`/`norm`（`cts-tour-price.ts`）、官网既有 `/api/revalidate`、Inngest 发布事件模式、service-role RLS 模板。
- platform-shared（L2 旅游版）：目录四张表结构、CSV 预览/应用/回滚管道、输出契约。
- client-specific（L4）：CTS 的团、班期、展示价、航司航段、别名（库内按 `client_id` 隔离，不进 shared 代码）。
- 新增事实源？**P1a 阶段目录不被任何渠道消费**；P1b/P2 切换时以「全量 diff 为零」为闸，逐步把第 1–8 处改为读目录，目标是收敛而非新增。
