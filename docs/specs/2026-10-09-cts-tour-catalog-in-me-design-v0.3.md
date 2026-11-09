# ME Tour Catalog（团目录）· CTS 首例 · 设计稿 v0.3

**日期**：2026-10-09　**状态**：v0.3（已吸收首轮与第二轮复审：子牙判「小修后可进入实现」，魏征判「再修订」，其 3 个阻塞项已写成可测条款），**未授权实施**
**来源**：PM 2026-10-09 拍板「团信息源头放 ME」（ledger：`2026-10-09-cts-tour-management-source-in-me`）+ 同日补充：客户（CTS）会自己开发独立下单系统，ME 统一管理产品，网页/广告/社媒/邮件读 ME，ME 与下单系统以 CSV 导入导出同步。
**承接**：[2026-09-14 Tour 管理模块规划](./2026-09-14-me-tour-management-module-plan.md) 的 P1（统一事实源）。**与该规划的差异见 §1。**

v0.2 → v0.3（第二轮复审）：别名只存 PM 显式批准的、短名临时计算；价格允许 TBC；幽灵班期预览告警 + 须逐条确认；应用/回滚改为单事务 + 乐观并发；`manages_departures` 显式标志；`catalog_version` 为只增不减的发布计数；P1b 切换点放进 `loadFirstPartyTourProducts` 内部；补首次导入预期拒收数与超限用例。

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
`id` · `client_id fk clients` · `slug` · `destination` · `tier` · `name` · `title` · `short_description` · `duration_text text`（如 "10 days"，**保持官网契约的字符串**，`durationDays` 解析依赖其中数字）· `display_price_text text null`（展示串，写入时必须通过 §6.4 校验；允许 TBC）· `manages_departures bool default false`（是否由目录管理班期；种子化时该团有任一班期即置 true；Stopover 类等无固定班期的团保持 false）· `highlights/itinerary/inclusions/exclusions/tour_cities jsonb`（沿用 `FirstPartyTour` 形状）· `single_supplement` · `max_group_size` · `is_active bool` · `sort_order` · `created_at/updated_at`。
约束：`UNIQUE (client_id, destination, tier, slug)`（slug 单独会重名，官网已有两个 `highlights`：`tours.ts:2530` 日本、`:2724` 越南）。

**`tour_catalog_aliases`**（CSV 名 → 团；**只存 PM 显式批准的别名**）
`client_id` · `alias_norm text` · `tour_id`；`UNIQUE (client_id, alias_norm)`。规范化函数 `norm()`：trim、小写、折叠空白、`&` 与 `and` **双向归一为同一 token**。
导入匹配顺序：①别名表精确命中 → ②与团 `name`/`title` 的 `norm()` 精确命中 → ③与「去 `—` 前缀档位词后的短名」命中（**匹配时临时计算，不入表**，所以不会撞唯一约束）。**任一步命中 ≥2 个团、或全部 0 命中，一律拒收该行并列出**，由 PM 在预览页补一条别名后重跑。**不做模糊匹配**。官网有 China Signature — Natural China 与 China Discovery — Natural China 两条，因此无档位的「Natural China」天然歧义，必须由 PM 先批准别名。

**`tour_catalog_departures`**（一个班期一行）
`id` · `tour_id fk` · `client_id` · `depart_on date`（**纯日历日，无时区**）· `return_on date null` · `price_text_override text null`（通过同一价格校验）· `status text check in ('open','limited','sold_out','closed','cancelled')` · `status_source`（'manual'|'csv:<批次id>'）· `status_as_of` · `internal jsonb`（航司/航段/人数上限等运营信息，**永不进任何对外输出**）· `created_at/updated_at`。
约束：`UNIQUE (tour_id, depart_on)`。

**`tour_catalog_import_batches`**（每次导入一行，审计 + 回滚）
`id` · `client_id` · `kind ('departures'|'status')` · `file_sha256` · `row_counts jsonb` · `before jsonb`（受影响行的导入前快照）· `after jsonb`（导入后快照）· `status ('previewed'|'applied'|'rolled_back'|'rejected')` · `applied_by` · `created_at`；`UNIQUE (client_id, kind, file_sha256)`。

**不新建**：价格计算、座位、订单、付款、报价单。回滚粒度只用批次 `before/after`，不再另设行级 `version`。

## 5. 输出契约（消费者零改动的前提，复审补全）

- **输出形状 = `FirstPartyTour`**（`first-party-tours.ts`）。ME 提供内部函数 `loadCatalogProducts(clientId)` 直接从库返回同形状数据；**P1a 不开放任何 HTTP 公开口，也没有任何渠道消费它**。
- **P1b 切换点**：放进 `loadFirstPartyTourProducts(domain)` **内部**——给它增加「domain → client_id」解析（来源：`clients` 表里该客户的官网域名字段，实现时核实确切列名），该域名若已启用目录则读 `loadCatalogProducts`，否则走原 HTTP。两个调用方（`web-intelligence/service.ts:51`、`conversions/cts-tour-price.ts:63`）签名不变；「零改动」仅指调用方，不指 loader 本身。
- **日期展示串规则**：`depart_on` → `"D Month YYYY"`（英文月份全称、日不补零，例 `13 May 2027`），与官网 `departureDates` 完全一致；`departure_pricing` 的 key 必须逐字等于这些展示串（官网契约：`tours.ts:34`）。
- **班期过滤**：`depart_on` 早于今天的不输出；`sold_out/closed/cancelled` 不输出；`open/limited` 输出。
- **整团可售规则**：输出的 `is_active = tour.is_active AND (NOT tour.manages_departures OR 至少一个未过期且 open/limited 的班期)`。`manages_departures=true` 的团全部班期售罄/过期/取消 → 整团不可售（避免广告继续推）；`false` 的团（如 Stopover 系列）按 `is_active` 原样。是否「管理班期」由显式标志决定，**不靠「库里有没有班期行」推断**（防导入误删/漏种子造成漏报）。
- **字段回退不变**：`name`/`title` 照原样输出（`firstPartyTourProducts` 取 `title || name`，`first-party-tours.ts:105`）；`duration` 输出 `duration_text`。
- **契约测试**：用现网读取口的真实 33 个团做 golden——ME 目录种子化后，`firstPartyTourProducts()` 的输出与现网逐字段一致（P1a 验收条件之一）。
- **`catalog_version`**：每个客户一个只增不减的发布计数（`tour_catalog_state(client_id, catalog_version)`），**每次发布 +1**；回滚批次同样视为一次新发布 +1，**绝不回退**（否则站点会拒收回滚后的正确数据）。
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
- **幽灵班期防护**（CSV 把 05-13 误写成 05-31，旧的 05-13 仍 open）：预览对文件中出现的每个团，① 列出「库里有、文件未提及」的未来班期；② 对新增日期与该团现有未过期班期相差 ≤14 天者标「疑似改错」。**有任何告警时，「应用」前 PM 须逐条勾选处理方式**（确认保留 / 标 cancelled），未处理完不能应用。
- 单文件大小上限（2 MB）、行数上限（2000）；单元格以 `= + - @` 开头的文本在**导出**时加前缀 `'` 防公式注入；导入时同样拒收可疑单元格。
- 预览必须列出：新增/改动/不变/拒收；**与官网现值冲突的行高亮**；任何一行无法匹配团、日期非法、返程早于出发、残缺值（如 `540+T`、返程为空且非允许）→ 拒收并报告，不猜。
- **权限**：上传可由 FDE/PM，「应用」「回滚」仅 PM/管理员（后台既有 admin 鉴权）；视为 A 级操作，写批次回执。
- **应用与回滚都是单个数据库事务（Postgres 函数）**，全成或全败；写入用乐观并发：`UPDATE … WHERE updated_at = <预览/批次记录时的值>`，任一行不符 → 整批中止并列出冲突行，不覆盖手改、不留半截。
- **回滚**：仅当受影响行当前状态仍等于该批次 `after` 时才恢复到 `before`（同样在事务内比对）；有任何后续手改 → 拒绝回滚并列出冲突行。
- **上限落点**：2 MB 与 2000 行在上传路由读取阶段（解析前）拦截，解析器内再次校验；超限整文件拒收。
- **公式注入检查只作用于文本列**（团名、备注等）：以 `= + @` 开头拒收；日期/状态等结构化列由严格解析器校验，不适用此规则。以 `-` 开头仅在数值列合法。

### 6.4 价格展示串校验
写入 `display_price_text` / `price_text_override` 时，复用 `cts-tour-price.ts` 已导出的 `parsePriceDisplayString`（实现时核实导出状态）：必须解析出**单一**币种和金额，且文本中不得同时出现多个币种；**例外：不含任何数字、含 `TBC` 的文本（如官网真实存在的 `From NZD $TBC per person`）允许入库**，并标记为价格待定——此时 `lookupTourPrice` 照旧返回 null、走人工任务，不猜价。其余解析失败 → 拒收，由 PM 修成「From NZD $X per person」类标准写法。（防止 `From AUD 5,200 (NZD $4,999 …)` 被误读。）

### 6.5 实现与设计稿的已知差异（2026-10-10，P1a 实现复审后记录）

- 幽灵班期告警 v1 为「看列表 + 单个勾选确认」，未做设计稿所说的逐条选择「保留 / 标 cancelled」；要把某班期标 cancelled 目前需另行修改状态（后台编辑页属 P1a-2）。
- 「与官网现值冲突的行高亮 / 差异页」推迟到 P1a-2；当前以 `docs/clients/cts/2026-10-09-2027-departures-vs-website.md` 的离线对比代替。
- 应用前增加 `planHash` 校验（预览与应用必须是同一份计划，否则 409 `plan_changed`），设计稿原未写，实现复审后补。
- 同一份文件在「已预览未应用」或「已撤销」状态下可重新预览（刷新原批次）；「已应用」状态仍拒绝重复上传。
- seed 失败时会删除本次刚插入的团（补偿），不是数据库单事务；seed 不递增 `catalog_version`（目录此阶段不被任何渠道消费）。
- `price.ts` 复用客户命名的 `cts-tour-price.parsePriceDisplayString`，后续应抽到中性模块；`todayIso` 默认时区写死 Pacific/Auckland，AU 客户需参数化。

### 6.6 后台编辑（PM 2026-10-10 要求并入 P1a，本地做完再上线）

- **可改的团字段**：name、title、short_description、duration_text、display_price_text（同 §6.4 校验，允许 TBC）、highlights、itinerary（逐天 day/title/description/meals）、inclusions、exclusions、tour_cities、single_supplement、max_group_size（正整数或空）、is_active、manages_departures。**不可改**：slug / destination / tier（它们是团的身份键，改了等于换一个团）。
- **班期**：可新增（出团日 + 返程日 + 状态 + 该班展示价）；已有班期可改返程日、状态、该班展示价；**出团日不可改**（改日期 = 把旧班期标「已取消」再新增一个，保留历史，避免幽灵班期）。
- **修改记录**：新表 `tour_catalog_change_log`（client_id、entity tour|departure、entity_id、action create|update、before、after、actor、created_at），RLS 仅 service_role。每次保存与修改记录**在同一个数据库函数里**完成（`tour_catalog_update_tour` / `tour_catalog_save_departure`），全成或全败，并递增 `catalog_version`。
- **防覆盖**：保存时带上读取时的 `updated_at`，库里已变则拒绝（409「已被别人改过，请刷新后再改」）。
- **权限**：同 P1a，仅 admin（`requireCatalogAdmin`）。
- **校验在应用层**（纯函数 `edit-validation.ts`，可单测），数据库函数只接受白名单字段，防止夹带 slug/client_id 等。
- **设计复审后补充（子牙/魏征 2026-10-10）**：
  - 修改记录改用**数据库触发器**统一写：团表、班期表的新增/修改/删除都自动记一条（含 CSV 导入、撤销、种子导入），`actor` 由各数据库函数用 `set_config('tour_catalog.actor', …, true)` 标明（导入写「import:批次 by 谁」，撤销写「rollback:批次」，未标明为 system）；只有 updated_at 变化的不记。
  - CSV 不会悄悄改动「已取消」的班期：文件里该班状态为空 → 保持已取消并提醒（cancelled_kept）；文件里明确写了可订等状态 → 照改但提醒「将重新开放已取消的班期」（reopens_cancelled），需勾选确认。
  - 撤销被手工修改挡住时，接口返回冲突班期的团名与日期，页面用专门文案告诉 PM 去手工改回或保留现状。
  - 把「是否管理班期」打开/关闭前弹二次确认（会影响整团是否对外可售）。
  - highlights、short_description 不在网站读取口契约里，编辑器标注「仅内部参考」。
  - 行程天数必须从 1 开始连续不重复。
  - 两个编辑数据库函数的所有读写都同时限定 id 与 client_id，且仅授权 service_role、只供团目录路由调用。

### 6.7 AI 助手对话框（PM 2026-10-10 要求：用自然语言改团，减少逐天手填的出错）

- **位置**：团目录页右侧常驻对话框（窄屏时折叠在列表上方）。
- **原则：AI 只提议、不落库。** 对话接口返回「回复 + 建议改动清单」，每条改动在服务端先过 `edit-validation.ts` 同一套校验并核对团/班期属于本客户；PM 在卡片上看到「改什么、旧值→新值」后点「应用」，才经由既有编辑接口写入（同样的乐观并发、修改记录、版本递增）。修改记录里的操作人仍是点「应用」的人。
- **上下文**：发给模型的是全部团的精简索引（id/名字/价格/天数/在售/班期/行程每天标题），模型可用 `get_tour_detail` 工具按需取某个团的完整行程/包含项（一次回复里多个取数请求会逐个回应）；每次对话最多 4 次模型调用（含最后一次提交，即最多查 3 轮详情）；最终用 `propose_changes` 工具提交结构化改动（纯问答则直接回文本）。服务端对行程缩短 / 多数标题改变的建议打警告，页面须勾选确认才能应用；同团多条建议键不重叠时合并成一次保存，重叠（如都改行程）则按顺序各存一次并沿用上一次返回的版本。
- **封装名**：界面只说「AI 助手」；供应商真名只在代码与日志。
- **边界**：不能新建团、不能改 slug/destination/tier、不能改出团日（与 §6.6 一致）；AI 给出的任何不在白名单内的改动会被服务端拒收并在卡片上标明。
- 层级：L2 旅游版交互层，复用既有 AI 调用封装与编辑接口，不新增能力线、不登记候选。
- **复审后记录的后续事项（未做）**：每客户每日 AI 用量/金额上限与同一管理员限流；系统提示启用提示缓存降低多轮成本；单价常量与 `src/lib/anthropic/client.ts` 共用；对话历史由浏览器回传（仅 admin，可伪造 AI 上一句，风险低）。

## 7. 分步计划

| 步 | 内容 | 风险级 | 说明 |
|---|---|---|---|
| **P0** | 只读差异报告：PM 2027 表 vs 官网读取口，输出差异清单给 CTS 确认（不碰库、不建表） | C | 直接回答 §9 问题 1；**建议先做** |
| **P1a** | 四张表 + 种子（现网 33 团）+ 班期 CSV 导入/预览/应用/回滚 + 只读后台列表 + 差异页；内部函数 `loadCatalogProducts`；**无 HTTP 口、不改官网、无渠道消费** | **A**（新表迁移） | 目录此阶段标注「未对账草稿」，不被任何渠道使用 |
| P1a-2 | 后台编辑页 | B | 从 P1a 拆出，视需要再做 |
| P1b | 官网读 ME：`chinatravel` 仓另开 PR；**切换闸 = 官网 vs ME 全量 diff 为零**；开 §5 的 HTTP 口；构建期拉取 + 运行期 ISR；**回退 = 构建时落盘的最近一次成功快照**，并要求 feed 带单调递增 `catalog_version`，站点拒绝应用低于已服务版本的 feed（防旧快照覆盖新数据）；版本比对在**构建期与各实例 ISR 重取时各自对照「构建时烘进去的版本」**，不依赖共享存储（版本只增不减，多实例最终收敛）；切换后禁止回写官网仓 | A（动已上线官网） | 需 PM 授权上线 |
| P1c | `/traveller-details` 团/日期下拉改读目录 | B | 与 P1b 同批 |
| P2 | 收敛第 3–8 处：让 `cts-tour-price.ts` **先读目录**（压过 `group_tours`）、`master_briefs.products`/`client_knowledge_facts`/`factory_config` 引用目录；`offerings.yaml`、`group_tours` 退役 | A/B | `service.ts:52-54` 的优先级链要在此处理 |
| P3 | 广告/社媒/邮件读目录；售罄班期自动排除；状态 CSV 读回 | B | 对接 IMPACT |

**Inngest**：「发布到官网」是客户可见副作用 → 事件 `tour_catalog.publish.requested`（仅人工点发布触发）→ 函数调官网既有 `/api/revalidate`（需 secret）→ 写回执（request id、client id、批次/catalog_version、结果、时间）；失败可见（后台显示「已发布但官网未生效」）。无人工发布事件则不得自动改官网（fail-closed）。CSV 应用本身不触发官网变化。

## 8. 当场试跑计划（P1a 交付前）

1. 用 PM 的 2027 表（脱敏拷贝）上传 → 预览显示「表 vs 官网」差异行 → 应用 → 内部函数输出通过 `parseFirstPartyTourFeed`，`firstPartyTourProducts()` 对种子团与现网逐字段一致 → `lookupTourPrice` 对目录团可查。
2. **负面用例（必须真跑）**：重名团（两个 `highlights`）→ 行被拒；`540+T`/返程为空 → 拒收；重复上传同文件 → 拒收；以 `=` 开头的单元格 → 拒收；CSV 缺班期 → 库内班期不被删；应用后手改一行再回滚 → 回滚被拒并列冲突；回滚无冲突批次 → 数据恢复。
3. **预期拒收数（首次导入）**：PM 的表里所有团名都不带档位，其中 6 行 Natural China 因同时命中 Signature/Discovery 两个团被拒，须先由 PM 批准别名（暂按 Signature）后重跑；表中 `540+T`/返程为空的 China Legacy 行同样被拒。其余按名可匹配。
4. 追加负面用例：文件超 2 MB / 超 2000 行 → 拒收；`From NZD $TBC per person` 种子入库成功且 `lookupTourPrice` 返回 null；CSV 把 05-13 改成 05-31 → 预览出现「疑似改错」+「文件未提及」告警且未处理不能应用；应用事务中途有行 `updated_at` 被改 → 整批中止且无半截写入。
5. 全程不碰官网、不外发。

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

### 6.8 保存与上架分开（PM 2026-10-10 拍板「做上架」；本机做完再上线）

**要补的洞**：目录只有一份数据，保存 = 改这唯一一份。§7 的「人工点发布才通知官网」只管住了「推」，管不住「拉」——官网 ISR 重取、以及 P2 接进来的客服/内容工厂/广告读到的都是工作数据，未上架的改动会漏出去。

**做法：工作稿 + 已上架版两层。**
- **工作稿** = 现有 `tour_catalog_tours` / `tour_catalog_departures`。保存、导入、撤回、AI 助手照旧只改这里。
- **已上架版** = 新表 `tour_catalog_published`（`client_id`、`version bigint`、`snapshot jsonb`、`summary jsonb`、`note text`、`published_by text`、`source_version bigint null`（退回时记来源版）、`created_at`；`PRIMARY KEY (client_id, version)`；RLS 仅 service_role，revoke anon/authenticated）。`snapshot = { tours: [...], departures: [...] }`，为上架那一刻工作稿的整行拷贝，**班期去掉 `internal`**（运营内部字段不进任何对外读取路径）。
- **`tour_catalog_state` 加列 `published_version bigint not null default 0`**。现有 `catalog_version`（每次写入 +1）语义改名为「工作稿修订号」，只用于并发防护；**对外的版本号一律是 `published_version`**（只增不减，退回也 +1，沿用 §5 的单调规则）。
- **渠道只读已上架版**：`loadCatalogProducts` 改为读最新一条 `tour_catalog_published.snapshot` 再过 `toFirstPartyTours`；**从未上架过 → 返回空**（fail-closed，P1b 的 loader 回落到原 HTTP）。`getCatalogVersion` 返回 `published_version`。后台页面继续读工作稿（`loadCatalog`）。

**上架流程（人点，不自动）**
1. `GET …/tour-catalog/publish/preview`：服务端算「工作稿 vs 已上架版」差异（纯函数 `diffCatalog`，按团 id / 班期 id 对齐），返回逐项 `{ tourName, field, before, after, risk }`、`draftVersion`（当时的 `catalog_version`）、`diffHash`。首次上架只给汇总（多少个团、多少个班期），不逐字段铺开。
2. `POST …/tour-catalog/publish`，body `{ draftVersion, diffHash, acknowledgeHighRisk, note }`。服务端**重算**差异：`diffHash` 不符 → 409「你看完之后又有改动，请重新查看」；无差异 → 400；含高风险项而没勾确认 → 400。再调 `tour_catalog_publish(p_client_id, p_expected_draft_version, p_actor, p_note, p_summary)`：单事务内锁 state 行、比对 `catalog_version = p_expected_draft_version`（不符 → `conflict:stale`）、从工作稿拼 snapshot、`published_version + 1`、写一行。
3. **高风险项**（单独标红、须多勾一次）：展示价、单房差、班期新增/日期/状态/单独价、团上下架、团被删除（工作稿里没有而已上架版里有）。其余（行程文字、亮点、包含项等）为普通项。
4. **退回**：`POST …/tour-catalog/publish/revert` body `{ version }` → `tour_catalog_revert_published`：把第 N 版 snapshot 作为**新的一版**（`published_version + 1`，`source_version = N`）。**只改已上架版，不动工作稿**——退回后页面会显示「工作稿与已上架版有 X 处不同」，由人决定改回工作稿还是重新上架。「放弃未上架的改动」（把工作稿还原成已上架版）本轮不做，记后续。
5. **权限与留痕**：上架、退回仅 admin（`requireCatalogAdmin`）；`published_by` 记操作者；每版 `summary` 存当时的差异汇总供「上架记录」页展示。

**本轮不做**：定时上架；按字段/按团部分上架（一次上架 = 整份工作稿）；上架后自动通知官网（P1b 的 Inngest 事件接在 `tour_catalog_publish` 成功之后，届时再接）；「用在哪里」影响清单（等官网与广告接入后才有内容）。

**对 §7 P1b 的修正**：官网无论构建期还是 ISR 都只可能读到已上架版；「发布到官网」的 Inngest 事件由「上架成功」触发，不再是独立按钮。

### 6.9 后台页面重排（PM 2026-10-10：「list 太长」）

现状：33 个团一列卡片铺到底（约 2760px 高），导入、叫法对照、导入记录全堆在团列表下面。
- **顶部状态条**：「已上架第 N 版 · 时间」/「还没上架过」+「X 处改动未上架 →［查看并上架］」。
- **四个页签**：团 ｜ 出团表导入 ｜ 上架记录 ｜ 叫法对照。导入、记录、叫法各自一页，不再压在列表下面。
- **团页签 = 左列表 + 右详情**：左边按系列分组（China Signature / China Discovery / China Stopover / Japan / Vietnam，可折叠，带个数），有搜索框和筛选（全部 / 有未上架改动 / 有班期 / 已下架）；每行只有短团名、展示价、下一班日期、小标记。点一行，右边显示这个团的编辑、班期、修改记录。
- **AI 助手**收成右侧抽屉，页面右上角按钮开合，不常驻占宽。
- 窄屏（< 1024px）：列表与详情上下切换（点团进详情，有「← 返回列表」）。

#### 6.8.1 设计复审结论（子牙 + 魏征/狄仁杰，2026-10-10；以下覆盖 §6.8 中与之冲突的写法）

**并入本轮（守「未上架不对外」「看到的 = 上架的」两条底线必需）**
1. **所有写工作稿的路径都涨修订号**：团表、班期表各加行级 AFTER 触发器调 `tour_catalog_bump_version`（seed 及将来任何直写自动覆盖）。预览与上架路由都「先读修订号、再读数据」。
2. **上架与退回都带两个期望版本号**（工作稿修订号 + 已上架版号），数据库函数在锁内比对；函数开头先 `insert … on conflict do nothing` 再 `select … for update`（seed 后直接上架时 state 行不存在）。`diffHash` = 完整投影后的两侧内容 + 两个版本号 + 高风险条数。堵「退回后重放旧上架请求」。
3. **快照由数据库函数在事务内从工作稿拼**（有第 1 条后版本比对是真闸）；`snapshot = { schema_version: 1, tours, departures }`，班期去掉 `internal`。
4. **退回走同一套「预览 → 哈希 → 高风险确认 → 版本比对」**；退回到当前版直接 400。**退回只换回文字与价格，班期状态保持现在已上架的**（两版都有的班期取当前状态；售罄/取消是事实，不随文案回滚），预览里列出「保持现状的班期」。
5. **退回后的下一次上架强制提醒并勾选**（最新一条已上架记录 `source_version` 非空时）。
6. **严格读取已上架版**：`schema_version` 不认识 → 视为未上架并记错误；班期状态认不出或缺失 → 不可见。读取结果区分「从未上架」与「已上架（版本号 + 团列表，可为空）」。加列规则：旧快照缺该列时的默认值必须等于加列前的对外行为。
7. **差异在输出层判定，字段白名单投影**：排除 `internal`、`updated_at`、`created_at`、`status_source`、`status_as_of`。高风险 = 展示价、单房差、团新增/移除、在售↔停售、`manages_departures`、班期新增/移除/状态/单独价、团名与对外标题改名，以及派生项「整团对外可售翻转」（两侧各跑一次 `toFirstPartyTours`）。验收：上架后立刻预览 = 零差异；只改 `internal` 的导入 = 零差异。
8. **防一键清空**：新版对外可售团数为 0，或比当前已上架版下降超过 30%，须手输新的可售团数才放行（与高风险勾选分开）。
9. **授权**：新表 RLS 仅 service_role + revoke anon/authenticated；新函数 revoke public/anon/authenticated、只授 service_role，不用 SECURITY DEFINER；已上架表触发器禁止 UPDATE/DELETE；内容与版本号从同一行读；`p_actor` 为空则拒绝；SQL 测试含「anon 读不了表、调不了函数」。
10. **工作稿读取改名 `loadDraftCatalog`** + 边界测试（`tour-catalog` 目录及其后台路由之外不得引用它、不得直读两张工作表）。`access.test.ts` 加「设了本机旁路环境变量仍然拒绝」（旁路误提交时 CI 变红）。
11. **用词**：团级开关统一叫「在售 / 停售」，「上架」只指发布动作；AI 助手提示词写明它不能上架。保存提示改为「已存为草稿，客人还看不到」。
12. **页面**：切换团/页签时有未保存内容先确认；分组由 `destination + tier` 数据生成，不写死系列名；AI 抽屉关闭时保持挂载。

**登记后续（本轮不做）**：放弃草稿改动；按团部分上架（A 团改到一半、B 团要紧急标售罄时只能一起上架）；草稿超过 N 天未上架进今日待办；目录导出 CSV 只导已上架版；P3 状态 CSV 的「变严状态快速通道」须 PM 定；改名与时长按中风险细分；`?via=assistant` 由客户端决定；`loadDraftCatalog` 两次查询非原子（仅致偶发 409）；本机 `next dev` 监听所有网卡。

#### 6.8.2 实施后复审与实测结论（2026-10-10，提交 1938962d7 之后）

三路：子牙逐条核对 §6.8.1 的 12 条（全部落实）；魏征/狄仁杰在本机库上真实攻击（权限、改写历史、错值、跨租户、并发 6 组、哈希 24 组、畸形快照、请求体绕过，均未打穿）；QA 以非技术使用者身份在浏览器走 22 项（18 过、1 不过、3 看不懂）。主窗口另做：两个数据库连接同时上架同一份草稿（后到者等 2 秒后被拒，只生成一版）；页面上真实走通「改价 → 上架 → 标已满团 → 上架 → 换回第 1 版」并查库确认换回后价格回到旧值而班期仍为已满团。

**复审后已修（本轮）**
- 有未保存修改时不能打开上架弹窗（给出提示，不丢修改）；浏览器刷新/关闭有保护；编辑器「取消」先确认；保存按钮贴底。
- 对照表：长文字围绕第一处不同截取（原来截前 200 字，两栏可能一模一样）；行程带天数序号；新增团逐条列出展示价、单房差和每个班期。
- 已上架团严格解析：`id` 非空、`is_active` / `manages_departures` 必须是布尔，否则丢弃该团；非法日期只丢该班期。
- 换回时班期状态：先按 id、再按（团，出团日）匹配当前已上架版并保持其状态；当前已上架版里已没有的班期一律以「已关闭」放回（不把已删除/已取消的班期以可订恢复）。SQL 与 TS 同一规则。
- 已上架表加「版本号必须是当前 + 1」的插入闸；两张工作表禁止 TRUNCATE。
- 首次上架必须手输对外可售团数；已上架版读不出来时拦住上架，不当成首次上架。
- 边界测试改为白名单式（目录之外出现 `tour_catalog_` 字样或引入白名单之外的模块即失败）。
- 文案：换回后的状态条、换回弹窗保留班期的说明、上架记录「换回 / 文字和价格同第 N 版」、导入页点明只改草稿、红色图例。

**登记后续（未做）**
- 团的展示价与班期「单独价」并存：改了团价而老班期仍是旧的单独价，对外会出现同一个团两种价。保存团价时应列出单独价不同的班期并问是否一起改（QA 实测踩到）。
- 换回后提供「把草稿也改回这一版」；列表与详情标明显示的是草稿价。
- 读取端按 `state.published_version` 取行（现按最大版本号）；`tour_catalog_state` 可被 service_role 直接改小或删行；`update … set client_id` 只给目标客户涨号；班期与团的 `client_id` 一致性无约束。
- 确认项只在 TS 层：SQL 函数本身接受无改动重复上架、空目录上架、超大备注与汇总。
- 操作者缺邮箱时记为 `unknown`，上架/换回应直接拒绝；`p_actor` 只去空格不去制表符。
- 每次降不到 30% 可分多次把可售团数降到很低而不触发手输。
- `todayIso` 默认奥克兰时区应改为读客户配置；client id 非 uuid 时返回 500。
- AI 助手改到「正在编辑且未保存」的团时没有二次确认。
- 筛选按钮显示数量；手机宽度下班期表格过窄；「叫法对照」页与修改记录里仍叫「班期表」；`TourDetail` 等几个函数超过 50 行；`publish.ts` 794 行，再加内容须拆。
- SQL 测试未接 CI（现为本机脚本重放三个迁移后执行）；补 authenticated 角色用例。
- P1b 接官网前：`loadPublishedProducts` 尚无任何调用方，接线时须再验一次「未上架不对外」；首次上架的基线应与官网当时在售团数比对。

#### 6.7.1 AI 助手知道「当前打开的是哪个团」（2026-10-10，PM 试用反馈）

PM 停在 China Panorama 上说「出发日期，从 5 月 8 号修改到 6 月 8 号」，助手反问是哪个团：请求体只有 `{ message, history }`，服务端没有「当前焦点团」的概念。
- 页面随每条消息带 `focusTourId`（「团」页签下详情区正在显示的团；其它页签为 null），输入框上方提示「当前打开：X。没点名的修改，默认改这个团。」
- 服务端把该团（id、团名、天数、展示价、全部班期，不含 internal）写进系统提示的「默认目标」一节：没点名一律指它；点了别的团名以点名为准；按日期找班期只在目标团里找，恰好对上一个才用，对不上或对上多个才反问；「出发日期从 A 改到 B」= 取消 A + 新增 B，返程日沿用原天数或按团天数推算并提示核对。`focusTourId` 来自浏览器，不在目录里的 id 当作「没打开任何团」。
- 不变：助手只出建议，管理员点「应用」才保存并记入修改记录。
- 真实调用验证（本机，3 次）：停在团上 → 直接两条建议（取消 2027-05-08、新增 2027-06-08 返程 2027-07-04）；不带焦点团 → 反问；停在 China Panorama 但点名 Silk Road → 改的是 Silk Road 的班期。
- 未做：把「正在编辑的那个班期」的 id 也带上（班期编辑状态在班期表组件内部；同一团内出团日唯一，按日期已能定位）。

### 6.10 给客户员工用：品牌头、Beta、后台入口、按账号留痕、权限隔离（PM 2026-10-10 经统筹窗口转达；本机做完，不上线）

**PM 要求**：页面别太素，加客户 logo 做成完整页面；让 CTS 员工用各自的 Magic Engine 账号登录来体验；放进后台工具入口；每次修改记下是谁改的；页面标 Beta。

**已核对的事实（2026-10-10 只读）**
- 身份：Supabase Auth；客户成员关系在 `client_portal_users`（email × client_id × access_type）。`requireDashboardClientAccess(clientId)` 已保证「只能碰自己客户」并返回 `user.email`、`role`、`tier`；middleware 对 `/dashboard/clients/<自己>/**` 放行客户成员，`/api/*` 由各接口自己鉴权。
- 现状：`requireCatalogAdmin` 只放行 admin 角色；页面 `page.tsx` 同样硬拦非 admin。
- 生产库（只读查询）：CTS 已有 3 行成员（access_type `both` / `dashboard`），0 个 scoped_admin；`master_briefs.vi_colors` = primary `#1a1a1a` / secondary `#d4af37` / accent `#c41e3a`（2026-08-27），与官网真实品牌（`#B61E2E` 红、`#D6A756` 金、背景 `#FBF7F0`，见 `docs/clients/cts/2026-09-03-cts-vi-design-system.md`）不一致；全库没有任何字段存客户 logo。官网 logo `https://www.ctstours.co.nz/logo.png` 可访问（200，image/png）。

**A. 权限模型（A 级）**
- `requireCatalogAdmin` 改为 `requireCatalogAccess(clientId, capability)`，返回 `{ ok: true, actor, role, permissions } | { ok: false, response }`。身份与隔离仍全部委托 `requireDashboardClientAccess`，不另写一套。
- 两种角色：`me_admin`（`role === 'admin'`，含受限 admin 仅限其客户）；`client_member`（`role === 'client-viewer'` 且 `tier === 'paid_client'`）。`self_serve`、`portal_only`、非成员一律 403。
- 能力表（服务端唯一一处定义，页面只读它的结果）：

  | 能力 | me_admin | client_member |
  |---|---|---|
  | view（看目录、对照表、上架记录、修改记录） | ✓ | ✓ |
  | edit（改团、增改班期） | ✓ | ✓ |
  | assistant（AI 助手出建议） | ✓ | ✓（受每日上限约束，见 C） |
  | import（出团表预览/生效/撤销）、aliases（叫法对照增删）、seed（读入官网） | ✓ | ✗ |
  | publish（上架、换回旧版） | ✓ | ✗（常量 `CLIENT_MEMBER_CAN_PUBLISH = false`；是否放开由 PM 定） |

  理由：Beta 期让客户员工体验「看 + 改草稿 + 用助手」，对外生效的动作与批量动作先留在 ME 管理员手里（fail-closed）；放开只改这一张表。
- 每个路由 handler 声明自己需要的能力；`GET …/tour-catalog` 额外返回 `permissions` 与 `viewer`（email、role），页面据此隐藏或禁用入口并写明原因（「测试版：上架由 Magic Engine 管理员操作」）。**页面隐藏不算防护，服务端逐接口拒绝才算。**
- 操作者一律取服务端会话的 email，请求体里的任何身份字段不读。email 取不到 → 拒绝写操作（不再落成 `unknown`）。
- 隔离证明：①用真实的 `requireDashboardClientAccess` 逻辑 + 假成员表，逐个 handler 验证「A 客户成员请求 B 客户」全部 403 且不触库；②SQL 层验证「在自己的 client_id 下传别家的 tourId / departureId / batchId / 版本号」全部被拒或零行；③`self_serve`、`portal_only`、未登录各一组。
- 本机登录旁路保持只在工作区；护栏测试继续盯住它。

**B. 按账号留痕**
- 已有：团与班期的每次增改由数据库触发器写 `tour_catalog_change_log`（谁、何时、哪个团/班期、改前、改后）；AI 助手应用的修改在操作者后带「(AI 助手)」；导入、撤销导入、上架、换回各自记操作者。
- 补：修改记录显示拆出「来源」（手动 / AI 助手 / 出团表导入 / 撤销导入 / 系统）并带年份；新增「修改记录」页签看整个目录最近 100 条（现在只能逐个团看）。
- 不做（登记后续）：change_log 加独立的 来源 / 角色 列（现编码在 actor 文本里）；别名增删与 seed 的操作者；撤销导入的 `rolled_back_by` 列。

**C. AI 助手用量上限（因为要开放给客户员工，花的是 ME 的钱）**
- 新表 `tour_catalog_assistant_usage(client_id, day, calls, cost_usd)`（service_role only）+ 函数 `tour_catalog_assistant_reserve(p_client_id, p_day, p_limit)`：原子地「未超限则 calls + 1 并放行」，超限返回 false；调用后把实际花费累加。每客户每日上限常量 `ASSISTANT_DAILY_CALL_LIMIT = 100`（按实测单次约 US$0.03–0.08，上限约合每天 US$8）。超限 → 429，页面提示「今天的 AI 助手次数用完了，明天再用或直接手动修改」。

**D. 品牌头（平台化：共享代码里不出现任何客户名、色值、logo 地址）**
- 新函数 `getClientBrand(db, clientId)` → `{ name, logoUrl | null, primary | null, secondary | null, background | null }`，数据来自该客户最新一条 `master_briefs`：`vi_colors`（已有）+ 新增可空列 `vi_logo_url text`（单独一个迁移文件，只加一列）。色值做严格校验（只接受 `#RRGGBB`），logo 地址只接受 `https://`；任何一项缺失或不合格 → 回落到 Magic Engine 中性配色、头部只显示客户名文字。
- 页面头：logo（有则显示）+ 客户名 +「团目录」+ 明显的 Beta 徽标 + 一句「测试版：每次修改都会记录是谁改的，欢迎反馈」+ 反馈 mailto。品牌色经 CSS 变量注入，只用于页头、主按钮、选中态与强调；金色类辅助色只做点缀（CTS VI 明确禁止大面积金色）。
- 字体：本轮不按客户切换（库里没有字体字段），沿用后台字体。
- **CTS 要显示成红金 + logo，需要把生产库 `master_briefs` 的 `vi_colors` 改成官网真实值并登记 `vi_logo_url`——这是改生产数据，须 PM 点头**；在此之前生产上会按现有（过时的黑金）显示。本机试用库里用桩数据填真实值。

**E. 后台入口**
- `industry-features.ts` 新增功能键 `tour_catalog`，与 `tailor_made` 共用旅游行业关键词（层级判定：L2 旅游版能力，别的行业不该看到）。
- 客户主页「工具」页签加卡片「团目录 · Beta」；受限管理员侧栏加同名入口。两处都只是链接，真正的闸在页面与接口。
- 页面 `page.tsx` 改用 `requireCatalogAccess(clientId, 'view')`；非旅游行业客户访问该页显示「这个客户没有开通团目录」。

**F. 交付前**：Impeccable 检查（检查程序本机已有，不需再下载），前后数字写进 PR；设计与实施各一轮 子牙 + 魏征 + 狄仁杰。

**不做**：不开任何账号、不发邀请；不新增对外公开接口；不让客户成员接触团目录以外的表。
**需要 PM 决定的**：①是否把 CTS 的品牌色与 logo 写进生产库；②CTS 员工能否自己上架（现为不能）；③给哪几位 CTS 员工开账号（现有 3 行成员是否就是他们）；④AI 助手每日上限数值。

#### 6.10.1 设计复审结论（子牙 / 魏征 / 狄仁杰 各自独立，2026-10-10；与 §6.10 冲突处以本节为准）

狄仁杰在本机库实测 20 余种跨客户越权调用（改团、增改班期、导入生效/撤销、换回、读修改记录），全部被拒，他客户数据零改动；表与函数对 anon / authenticated 均无权限。洞不在隔离，而在「谁算客户成员」、输入上限、返回裁剪、留痕四处。

**改了的决定**
1. **谁能用 = 显式名单，不是「付费成员」。** 现有成员可在「设置 → 用户权限」自行给任意邮箱加成员（`/api/clients/[id]/users` 只要求付费成员），`fde` 与环境变量成员也算付费档。新表 `tour_catalog_members(client_id, email, granted_by, created_at)`，只有 ME 全局管理员能增删（页面「设置」页签）。角色两种：`me_admin` = 全局管理员（`role==='admin'` 且无 `allowedClientId`）；`client_editor` = 通过 `requireDashboardClientAccess`（非 self_serve / portal_only）**且**邮箱在名单里。受限管理员、演示账号不在名单里就进不来；在名单里也只是 `client_editor`。名单默认为空 = 默认没有任何客户员工能进。
2. **能力表（穷尽类型，服务端唯一定义）**

   | 能力 | me_admin | client_editor |
   |---|---|---|
   | view、edit、assistant、request_publish | ✓ | ✓ |
   | import、aliases、seed、publish、manage_members、manage_settings | ✓ | ✗ |

   每个 handler 以字面量声明能力；一条测试枚举目录下全部 `route.ts` 的导出方法对照期望表，新增未登记即红。`GET publish`（状态条用）= view；`GET publish/revert` = publish；`POST preview` = import（它会写批次表）。
3. **返回按角色裁剪（页面没显示不算保护）**：`client_editor` 拿不到导入批次、叫法对照、班期 `internal`（快照与修改记录的改前改后都剔除）、上架备注；ME 人员的邮箱对客户员工显示为「Magic Engine 团队」。
4. **改完要有人知道**：`client_editor` 的主按钮是「请 Magic Engine 上架」→ 写一条请求（谁、何时、当时草稿修订号、备注）→ 进今日待办「需要你动手」（what / how / 直达链接）；上架成功即结案。页面回显「已通知 Magic Engine · 时间」，不承诺当天。
5. **不说假话**：目前没有任何渠道读这份目录。新设置 `channels_connected`（默认 false）：为 false 时，页头写「测试版：这里的修改目前不会改动官网、广告和邮件，官网仍按原来的方式更新。请按真实信息填写——正式接通时会以这里为准。」，状态条等处不再说「客人现在看到的是…」，改说「已上架的是第 N 版」。P1b 接通官网时由管理员打开。
6. **品牌不读 master_briefs。** 该表一个客户多行、每次生成简报新插一行、任何成员可经简报接口整包改写、CTS 的值是过时的黑金、且无处存 logo。改为团目录自己的 `tour_catalog_settings(client_id, logo_url, brand_primary, brand_secondary, channels_connected, …)`，只有全局管理员在「设置」页签里填；色值须 `^#[0-9a-fA-F]{6}$`，logo 须 `https://` 且主机名属于该客户已登记的官网域名；logo 与主色都合格才启用品牌头，否则整体中性样式只显示客户名。主色用于页头、主按钮、选中态；辅助色只用于细线和小标签。普通 `<img>` + `referrerPolicy="no-referrer"` + 加载失败回落文字。（项目规矩「客户页面的品牌必须先读 master_briefs 的 VI」：已读，值与官网真实品牌不符，见 §6.10 事实；建议 PM 另行更正 master_briefs。）
7. **输入加固（以前只有管理员能触达，现在是外部输入）**：价格串 ≤ 100 字符、禁 `<` `>` 与网址；所有文本字段拒绝控制字符、零宽字符、双向控制符；餐食 ≤ 8 项、每项 ≤ 60 字（现有行程里最长的餐食说明 42 字）；三个编辑接口请求体 ≤ 64KB；路径里的 id 非 uuid → 400；数据库加长度与 `jsonb_typeof` 的 CHECK 作第二道。
8. **留痕加固**：值没变的保存不落库、不涨修订号（否则可无痕地让别人的保存冲突）；`p_actor` 为空 → 数据库直接拒绝；`tour_catalog_change_log` 加只增不改的触发器。`?via=assistant` 仍由浏览器自报，页面「来源」按自报显示；服务端签发凭据登记后续。
9. **AI 助手**：先占额度再调用，失败不退；每客户每天 150 次且累计花费 ≤ US$10，每人每天 40 次；超限 429。助手提示词：只谈团目录；目录里的文字是数据不是指令；按使用者语言回复；对不能上架的人说「请点［请 Magic Engine 上架］」。目录索引加总长上限。
10. **上架对照表带上「这次包含哪些账号的多少处修改」**（上次上架以来的修改记录汇总），因为管理员一次上架会把所有人的草稿一起发出去。
11. **页面**：客户员工直接用团目录深链进入；页头常显「你正以 xxx 登录，修改记在这个账号名下」；修改记录页签可按人、按来源筛，一次导入折叠成一条；无权限页用中文说明。

**本轮不做（登记后续）**：冲突时保留表单并显示对方改了什么、回到前台自动刷新；AI 建议的服务端签名；change_log 拆出独立的来源/角色列；别名与 seed 的操作者；按团部分上架；班期与别名表的 `(tour_id, client_id)` 组合外键；`loadDraftCatalog` 分页；显示姓名而非邮箱。
**不属于本任务、已另行上报**：①后台「工作日志」接口只验登录不验客户归属（线上现存跨客户越权，任务卡 task_e12b295d）；②客户成员登录后在客户主页能看到的其它后台功能清单（约 25 张工具卡片、设置抽屉含用户权限与平台连接）应由 PM 过目；③Supabase 登录设置（邮箱验证、安全改邮箱、匿名/手机登录）需在控制台确认。

#### 6.10.2 实施后复审与实测结论（2026-10-10，提交 cb9b69f3a 之后）

三方各自独立：狄仁杰在本机库与临时测试里真打（47 行身份矩阵、22 个 handler 逐个读源码、返回全量 dump、logo/色值/邮箱的畸形输入、留痕与 AI 额度的 SQL 实测含并发 30 个）；子牙逐条核对 §6.10.1 的 11 条；魏征在浏览器里以管理员走全流程并读代码评客户员工视角。

**没打穿的**：鉴权核心（未登录、无邮箱、受限管理员、fde、环境变量成员、self_serve、portal、跨客户名单、大小写与同形字、名单查询出错——没有任何「不该过却过了」或「错拿管理员」）；能力声明（每个 handler 取客户编号后第一句就过闸，失败直接返回）；跨客户读写；留痕（同值不落库、空操作者被拒、修改记录禁改禁删）；AI 额度（各上限、并发、跨天）。

**查出并已修（本轮）**
- 【真漏洞】两个班期保存接口的回包带出了班期内部信息（航司、机位、航线）给客户员工；已改为三处共用同一裁剪函数并补测试。
- 助手提示词不知道「渠道是否接通」；详情改动行、导入页、换回弹窗、对照表列名等仍说「对外 / 客人」；界面默认值方向反了（未包裹时默认「已接通、可上架」）——全部改为跟随 `channels_connected`，默认最保守。
- 上架请求「每客户一条未处理」改由数据库部分唯一索引 + 原子函数保证。
- 行程大小约束由 `pg_column_size` 改为 `octet_length(itinerary::text)`。
- 读入官网产生的几十条系统记录折叠成一条。
- 保存被拒时自动跳到第一处红字并在保存栏提示；价格输入框下常驻写法说明；上架后清掉「已存为草稿」；账号数不把「系统」算进去；首次上架写「首次上架」；提交请求后回显写明「还没上架」；中途失去权限显示平静说明；手机上班期改竖排小卡。
- `hasLogin` 按后台准入档位判断；边界测试不再豁免本机试用页并断言其不在版本库里。
- 员工自己的修改在自己眼里曾被显示成「Magic Engine 团队」（主窗口实测发现）；已改为使用者永远看得到自己的邮箱。

**当场试跑（真实执行，本机库）**
- 以客户员工身份（本机试用块模拟 staff1@ctstours.co.nz）在浏览器里：只见团 / 修改记录 / 上架记录三个页签；改班期为已满团并保存；点「请 Magic Engine 上架」提交备注；回显「已通知 Magic Engine 团队 · 2026年10月10日 18:22。还没上架，对方核对后会上架。」
- 同一身份直接调 10 个不该有的接口（上架、换回预览与执行、读入官网、叫法对照增删、出团表预览、名单读写、设置）→ 全部 403；快照里无班期内部字段、无导入批次、无叫法对照；价格里带脚本标签 → 400；请求体里伪造的操作者被忽略，库里记的是会话账号。
- 切回管理员：修改记录显示「staff1@ctstours.co.nz · 手动 · Best of China · 展示价 4,080 → 4,180」；状态条下显示该员工的上架请求；上架后请求结案。
- 待办生成函数对本机库实跑：那条未处理请求生成 1 条待办，what / how / href 齐全。
- 测试：vitest 五个目录 2170 条，2169 过，1 条预期失败（本机试用护栏；按提交内容剥掉试用段后 284 条鉴权测试全过）；四个 SQL 测试文件 296 PASS / 0 FAIL；Impeccable 7 → 5 条（余下为全后台统一的字体与米色底、主从布局的首屏判定、一处定位不到的卡片嵌套、一处禁用按钮的对比度，均为既有设计取舍或误报）。

**上线前必须做（非代码，需 PM / 有权限的人）**
1. 应用四个迁移前，先在生产库跑迁移文件顶部注释里的只读预检（现有数据不得违反新约束）；迁移必须先于代码上线。
2. Supabase 控制台确认：邮箱验证开启、安全改邮箱开启、匿名与手机登录关闭。
3. 确认线上 `ADMIN_EMAIL_DOMAIN` 的值——该域名下任何邮箱都是能上架、能改名单的全局管理员。
4. 确认该客户在 `clients` 表登记的官网域名是完整域名（logo 地址按它校验）。
5. 由全局管理员在「设置」页签填品牌（logo、主色、辅助色）并把要试用的员工邮箱加入名单；这些员工须已有该客户的后台登录账号。
6. 另行处理：后台「工作日志」接口跨客户越权（task_e12b295d）；客户成员在客户主页能看到的其它后台功能由 PM 过目。

**登记后续（未做）**
- 价格串校验只查包含不查整串（`1199From NZD $7,899 per person` 能存）；全角尖括号、HTML 实体、`javascript:`、电话等能进价格；文本字段未拦 C1 控制符与若干不可见字符；数据库约束只管长度与「是数组」。**打开 `channels_connected`、把内容送进官网之前必须补，且下游渠道必须自行转义。**
- 被移出名单的前同事，其历史修改在其它员工眼里显示成「Magic Engine 团队」（应软删除或显示「已移出的成员」）。
- 编辑接口无频率限制；修改记录只增不删会一直变长。
- 上架请求提交后的即时通知（今日待办邮件周五、周六不发）。
- 路由能力枚举测试可被 `export { POST } from` 等写法绕过，应改为导入模块枚举导出。
- 字段名「对外标题」、服务端返回的「已关闭（现在对外已没有这个班期）」未随开关改口；管理员侧少数文案同理。
- AI 额度按 UTC 日切（新西兰约中午重置）而页面说「明天再用」；管理员的调用也占客户额度。
- 换回旧版成功后不会给上架请求结案；贡献者统计单次最多读 5000 行。
- `src/app/dashboard/clients/[id]/page.tsx` 因新增卡片到 802 行（原 794）；`price.ts` 引用带客户名的模块（原有）。

### 6.11 字段补齐与图片（PM 2026-10-10「补齐」；本机做完，不上线）

**缺口（已核对，见台账 2026-10-10-cts-tour-catalog-field-gap-vs-website）**：官网团数据约 30 个字段，目录只承接了一半。简介与亮点在编辑器里有栏位但读进来是空的（官网的内部读取口不输出）；逐日行程丢了住宿、节日标记、航司标志；主图、图集、SEO 标题与描述、标签、常见问题、整团售罄、单房差说明、评分与评价、推荐阅读、快速回答在目录里根本没有。图片地址现在写在官网代码里，分布在四处：官网项目的存储（64 处）、站内相对路径（15 处）、图库 images.unsplash.com（26 处）、ME 自己的存储（2 处）。

**验收（唯一标准）**：对官网全部团，「官网团数据」→ 读入目录 → 上架 → 目录按官网格式输出，逐字段比对差异为零；允许的例外只有两项并须在比对里显式列出：已过期的班期不输出、`updated_at` 以目录为准。

**A. 官网读取口补字段（chinatravel 仓，另开草稿 PR，B 级）**
`/api/internal/tours` 是公开只读口，内容与公开团页面相同。追加输出：`short_description`、`highlights`、`hero_image`、`gallery`、`meta_title`、`meta_description`、`tags`、`faqs`、`sold_out`、`single_supplement_note`、`rating`、`review_count`、`review_summary`、`related_blog_slugs`、`quick_answer`；`itinerary` 每天追加 `accommodation`、`festive_label`、`operator_logo`。只增不改，现有消费者（ME 的解析器忽略未知字段）不受影响。上线需 PM 同意；在此之前本机用「从官网代码直接生成的读取口内容」做读入与比对。

**B. 目录补栏位（ME，新迁移 `20261010400000_tour_catalog_content.sql`，未应用到生产库）**
- `tour_catalog_tours` 新列：`hero_image text`、`gallery jsonb '[]'`、`meta_title text`、`meta_description text`、`tags jsonb '[]'`、`faqs jsonb '[]'`（每项 `{question, answer, link?: {href, label}}`）、`sold_out boolean not null default false`、`single_supplement_note text`、`rating numeric(2,1)`（0–5）、`review_count integer`（≥ 0）、`review_summary text`、`related_blog_slugs jsonb '[]'`、`quick_answer text`。各带长度 / 类型 CHECK。
- 逐日行程每天追加可选 `accommodation`、`festiveLabel`、`operatorLogo {src, alt}`。
- `tour_catalog_settings` 新列 `image_hosts jsonb '[]'`：允许的图片主机名名单，只有全局管理员能改。
- `tour_catalog_update_tour` 的可改字段白名单加入上述新键（`create or replace`，其余逻辑逐行保留：操作者为空拒绝、同值不落库、并发令牌、client_id 过滤）。
- 快照：新列在旧快照里缺失时按「空 / 空数组 / false」读，等于加列前的对外行为（§6.8.1 第 6 条的加列规则）。

**C. 图片与链接是外部输入（客户员工可改）**
- 图片地址（主图、图集、航司标志）只接受两种：站内相对路径（以单个 `/` 开头，不含 `//`、`..`、反斜杠、控制字符）或 `https://` 地址且主机名在该客户的 `image_hosts` 名单里（或属于其登记的官网域名）；≤ 500 字符。图集 ≤ 30 张。
- 常见问题里的链接 `href` 只接受站内相对路径（同上规则）；问题 ≤ 300 字、回答 ≤ 3000 字、≤ 30 条。标签 ≤ 30 个、每个 ≤ 60 字。SEO 标题 ≤ 200、描述 ≤ 500。快速回答 ≤ 1500。推荐阅读 slug 只允许小写字母、数字、连字符。评分 0–5 一位小数。所有文本沿用 §6.10.1 第 7 条的字符规则。
- 「读入官网」时把读取口里出现的图片主机名写进 `image_hosts`（来源是客户自己的官网，由全局管理员触发）；之后管理员可在「设置」页签增删。
- 本轮图片做到：能看缩略图、能换地址、能增删、能调顺序。**上传图片文件本轮不做**（需要定存储位置与配额，另行设计）。

**D. 读入与输出**
- `FirstPartyTour` 类型与解析器追加上述字段，全部可选（其它消费者不受影响）。`seedCatalog` 写入新列。
- 新输出函数 `toWebsiteTours(tours, departures, today)`：产出与官网读取口同形的完整结构，是 P1b 官网改读目录时的契约，也是本轮零差异比对的被比对方。现有 `toFirstPartyTours` 不变。
- 上架对照表：新字段都有中文名；`sold_out` 变化为高风险，其余为普通项；图集按「新增 / 移除 / 顺序变化」各出一条。

**E. 页面**
- 团详情（只读视图）显示主图缩略图、简介、亮点、天数、展示价，不再只有班期。
- 编辑器按组折叠：基本信息 ｜ 图片 ｜ 行程（每天含住宿与节日标记）｜ 包含与不含 ｜ 常见问题 ｜ 搜索与标签 ｜ 评价。图片组：主图预览 + 换地址；图集缩略图网格，可加地址、移除、上移下移；地址不合规时给大白话错误。
- 已有目录的补读：目录非空时「读入官网」不可用（现状）。本轮不做「只补空字段」的回填；生产库尚无数据，上线后首次读入即带全字段。本机试用库重建后重新读入。

**不做**：图片上传；按字段细分客户员工权限（评分、SEO 等仍属 edit）；`operatorLogo` 的可视化编辑（原样保留，随行程一起保存）。

#### 6.11.1 设计复审结论（子牙；魏征 + 狄仁杰，2026-10-10；与 §6.11 冲突处以本节为准）

**对 §6.11 的更正**
- 官网读取口的 `itinerary` 本来就整段输出（含每天的住宿、节日标记、航司标志），这三项是丢在 ME 的解析与保存环节，不是官网没给。读取口要补的是团级字段。
- 官网没有图片主机名单，也没有内容安全策略：图片地址原样交给浏览器。所以 **ME 的校验是唯一一道闸**。
- 团的评分不进结构化数据，只显示在团卡片上（文案写死「N Google reviews」）。

**验收标准（修正）**：比对在读取口的归一形态上做（没写的可选字段 → `null` / `[]` / `false`），对象深比较。允许且须显式列出的例外共四项：`id`（目录用自己的编号；官网 `id` 有重复，不承接）、`created_at`（目录不存）、已过期班期不输出、`updated_at` 以目录为准。读入时任何一条「解析不了 / 被跳过」的备注都算比对失败。
**「零差异」≠「官网页面一致」**：官网团页面里另有按团写死在组件里的内容，不在这些字段内，目录改了官网不会变——8 个主推团的图集、3 条售罄横幅（连价格一起写死）、圣诞标记、南岛票价徽章；体验筛选用亮点原文做精确匹配，改一个字该团就从筛选里消失。这些是 P1b 接通前要另行清理的官网欠账，本轮只登记。

**实现上的决定**
1. **对外完整输出 `toWebsiteTours`**：snake_case，与读取口同形；`is_active`、`sold_out` 输出库里存的原值，不做「整团可售」推导（现有 `toFirstPartyTours` 的推导给广告用，保持不变）。七个官网必填字符串为空时输出 `''` 而不是 `null`。
2. **行程新键在六处同时放行**（读入解析、读库、保存校验、上架投影与对照表、对外输出、AI 助手），否则任何一次行程保存都会把住宿等整体清空。AI 助手改行程时，服务端按天号把住宿、节日标记、航司标志合并回去（助手没给就保留原值）。
3. **官网专属内容不做成共享表的类型列**：`related_blog_slugs` 进 `site_extras jsonb` 透传（读入、原样输出、不可编辑）；节日标记、航司标志留在行程里当可选键。其余新字段为旅游行业通用，做成列。
4. **更新函数改成数据驱动**：可改列的白名单放一处，按补丁里的键动态生成赋值，不再每个字段手写两遍（漏一行的后果是「判为同值、改动被静默丢弃」）。配测试：对白名单里每一列打补丁，断言行真的变了。
5. **所有可编辑文本（新旧全部）禁 `<` `>`**。官网把这些文本直接序列化进页面里的结构化数据脚本块，尖括号可以截断脚本；现有 33 个团的数据里没有尖括号，不破坏零差异。官网侧的转义（结构化数据输出、行程邮件模板）列为 P1b 接通的前置条件。
6. **字段分两档，服务端强制**（新能力 `edit_site`，只给全局管理员）：
   - 客户员工可改（`edit`）：原有字段 + 单房差说明、整团售罄、每天的住宿与节日标记、主图与图集（**只能从本客户目录里已有的图片中挑、调顺序、移除**）。
   - 仅管理员（`edit_site`）：评分、评价数、评价摘要、SEO 标题与描述、标签、常见问题、快速回答、航司标志、填入新的图片地址。客户员工提交这些键 → 403。
   - AI 助手的可改范围更窄：不含上述管理员专属键，也不含图片。
7. **图片地址规则**：站内路径只认 `^/images/[A-Za-z0-9._/-]+\.(jpg|jpeg|png|webp|avif)$` 且不含 `..`；`https://` 地址须能解析、无账号、无端口、主机名在该客户的 `image_hosts` 名单或其登记官网域名内，扩展名若有则不得是 svg；≤ 500 字符。**已在本客户目录里出现过的地址视为合规**（读入的现有数据不会因为名单没配而保存失败）。名单**不自动写入**：「设置」里列出目录里出现过、但不在名单里的主机及次数，由管理员逐个加入；不接受 IP，至多 10 个。
8. **数量与长度**（接口层；数据库约束再宽一档）：图集 ≤ 30；常见问题 ≤ 12 条、问 ≤ 300、答 ≤ 1000、链接只允许 `^/[a-z0-9/-]+$` 且不以 `/api/`、`/admin`、`/marketing` 开头、链接文字 ≤ 200；标签 ≤ 30 个、每个 ≤ 60 且 slug 化后非空、同团不重复；SEO 标题 ≤ 120、描述 ≤ 400，单行；快速回答 ≤ 1500；单房差说明与评价摘要 ≤ 300，单行；住宿 ≤ 300、节日标记 ≤ 60，单行；航司标志说明文字 ≤ 200；评分 0–5 且至多一位小数；评价数为非负整数。
9. **后台里预览图片**：只渲染服务端校验通过的地址，输入过程中不预览；`referrerPolicy="no-referrer"`、懒加载、固定尺寸、加载失败换占位块；站内路径拼接的域名只来自服务端下发的客户登记域名；列表每个团只出主图，图集只在打开的团里加载。
10. **上架对照表**：新字段都有中文名；整团售罄、主图、评分三项、SEO 标题与描述、单房差说明、常见问题里的链接、航司标志为高风险；图集先出「新增 / 移除 / 顺序变化」；行程每天的住宿等变化要显示得出来。
11. **「和官网现在的内容比一下」**：把零差异比对做成随时可跑的差异报告（管理员在「设置」页签点一下，读官网读取口与目录草稿比对，列出不同的团与字段）。读入之后到接通之前，两边都可能被改；接通当天以这份报告清零为准。
12. **读入**：只在目录为空时可用（现状不变），所以上线首次读入必须发生在官网读取口补齐字段之后，否则新字段会永久为空。写进上线检查。

**需要 PM 知道 / 决定**
- **官网现有的评分数字对不上**：6 个团的卡片显示 4.6–4.9 分、94–312 条「Google reviews」，另有 1 个团 4.9 分配 0 条；而官网代码里自己登记的核实值是 4.4 分、12 条。本轮按原样读入并设为仅管理员可改、改动算高风险；这些数字是否该继续对外显示，是客户官网现存的问题，须 PM 定。
- **客户员工本轮不能加新图**：没有上传功能，员工手里只有照片没有地址。本轮员工只能在已有图片里挑选、排序、移除；要加新图须把照片交给 Magic Engine。上传要先定三件事：存在哪（客户官网的存储还是 ME 的）、单张大小与配额谁出、上传即公开时版权责任归谁与谁能删。
- **测试期内以谁为准**：页头写的是「正式接通时以这里为准」，而官网代码这段时间还会继续改。

#### 6.11.2 实施后复审与实测结论（2026-10-10，提交 bd8c732a1 之后）

**验收结果**：官网 33 个团（21 个班期、327 天行程、107 处图片地址）读入目录 → 上架 → 按官网格式输出，逐字段差异为 0；读入备注 0；两边各自独有的团为 0。例外仅设计允许的四项（`id`、`created_at`、`updated_at`、已过期班期——实际命中 2 个：Legacy of China 的 2026-08-13、Colorful Yunnan 的 2026-09-10）。实现方在本机真库上跑通（含真调上架函数取真实快照再解析），子牙另行**独立复现**（绕过解析器直接拿原始数据逐键比对仍为 0），并故意改坏 11 处确认比对器各报出 1 处。数据来自 chinatravel 草稿 PR #229 的读取口输出（官网代码直接生成，尚未上线）。

**狄仁杰实测（员工身份）**：管理员专属的 8 个键、清空、同值带回、键名大小写与下划线变体、藏进嵌套对象、池外图片、航司标志的增改删——全部被拒且未落库；跨客户改新列被拒；数据驱动更新函数的键名注入不成立；新列对 anon / authenticated 无权限。结论：可以开放给名单内客户员工。

**复审查出并已修**
- 图片地址可带尖括号、引号、零宽字符（会进官网的结构化数据脚本块）→ 图片地址只允许安全字符集，不允许 `#` 片段；svg 判定对解码后的路径做。
- 「已在图片池里就算合规」排在所有检查之前 → 改为只豁免「主机名在名单内」这一项，协议、字符、长度照查。
- 官网读入几乎不校验，读取口一旦被污染会原样进库并长期有效 → 读入时对每个团跑与保存相同的文本、链接、数值规则和图片形状检查；不合规的字段置空并写读入备注（备注非空即比对失败）。
- 新代码读到旧形状的读取口时新字段全空、之后比对是假的「一致」→ 读取口里所有团都没有主图和简介时拒绝读入；目录非空时拒绝再次整份读入。
- 比对器看不见解析器丢掉的东西 → 解析时丢弃的条目、不认识的键都留备注并进比对结果。
- AI 助手改行程时按天号带回住宿，插入或删除一天后全部错位 → 改为先按标题对应、天数没变才按天号、对不上的不带并提醒逐天确认。
- 几份手写的可改键名单（数据库白名单、接口映射、管理员专属、助手可改）加测试钉在一起，任何一侧漏改即红。
- 文本规则补行分隔符；简介与亮点旁过时的「仅内部参考，网站暂不读取」已去掉。

**上线顺序（必须按此）**：① ME 五个迁移（先跑各迁移顶部的只读预检）→ ② ME 新代码 → ③ 官网读取口改动（chinatravel PR #229）上线并确认读取口带新字段 → ④ 首次读入（目录必须为空）→ ⑤ 「和官网现在的内容比一下」为 0 → ⑥ 才谈接通。反过来的风险：新代码先于迁移 → 读入失败；在 ③ 之前读入 → 现在会被拒绝（不再静默读成空）。

**登记后续（未做）**
- 管理员新填的图片地址在保存前就出缩略图（设计要求保存通过后再预览；仅管理员可触发）。
- 图片上传（见 §6.11.1 需 PM 决定的三件事）；图片池里含航司标志图，员工在选图弹窗里能把它选成图集图。
- 两端契约的缺口，P1b 时处理：`created_at`（官网类型必填、目录不存）、`tier` / `destination` 的固定取值、七个必填字符串为空时官网侧的兜底、`updated_at` 取 UTC 日期、不带年份的出发日、读取口缓存 1 小时。
- 官网欠账（不在这些字段内，目录改了官网不会变）：8 个主推团的图集、3 条售罄横幅（连价格）、圣诞标记、南岛票价徽章写死在页面组件里；体验筛选按亮点原文精确匹配；结构化数据输出与行程邮件模板未转义。
- `site_extras` 目前由共享代码认 `related_blog_slugs` 这一个键名，第二个客户的站点专属字段要改四处；常见问题链接的前缀规则略粗；纯中文标签被拒；重复的小工具函数；`AssistantPanel.tsx` 781 行。
- 员工删除或挪动带航司标志的那一天会被拒，页面只说「这一项只有 Magic Engine 团队可以改」，应指明是哪一天。
