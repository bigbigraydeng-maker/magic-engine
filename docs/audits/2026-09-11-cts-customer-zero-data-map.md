# CTS Customer Zero 事实审计（2026-09-11）

## 审计边界

- 仓库基线：`origin/main` = `10d4832a7702f6736f68a37c1b37ccac16387063`。
- 客户：CTS Tours NZ，客户 ID 只出现在本审计文档和运行时请求上下文，不写入共享代码。
- 查询方式：Supabase service-role 只读查询；没有写入生产数据、没有执行外部动作、没有读取 OAuth token 内容。
- 事实状态：下表区分“已连接且有证据”“已连接但数据不足”“未连接/未知”。未知不被补齐为事实。

## CTS 数据地图

| 数据域 | 数据源 / 表或接口 | 当前状态 | 新鲜度 / 质量 | 客户归属 | 可支持的判断 | 当前缺口 |
|---|---|---|---|---|---|---|
| 客户身份与行业 | `clients` | 已连接 | 配置存在；行业为 `travel` | `clients.id` | 判断行业剧本、客户范围 | 不是经营事实本身 |
| 客户目标 | `goals` | 已连接 | 可读到 7 条；最近更新 2026-09-07；没有 `active` 目标，最近目标已过期 | `goals.client_id` | 目标、指标、时间窗 | 需要当前有效目标，不能把过期目标当当前目标 |
| Master Brief | `master_briefs` | 已连接 | v1 active，2026-08-27 更新 | `master_briefs.client_id` | 客群、购买触发、关键词、产品范围、竞品线索 | `products` 为 `null`，没有可逐团对位的 CTS 产品事实 |
| 关键词 | `keywords` / 既有关键词 resolver | 代码已接入；本次未将搜索量当作产品事实 | 必须以 DataForSEO/GSC 观测时间为准 | `keywords.client_id` | 搜索需求、SEO 机会、旅游范围推断 | 不能替代 Tour 目录、价格、余位 |
| GSC / GA4 | `google_oauth_tokens`、`platform_oauth_connections` | 已连接 | OAuth 元数据更新至 2026-09-10；scope 含 GSC readonly、GA4 readonly | `client_id` | 搜索、流量、漏斗、品牌搜索 | 本审计未将未重新拉取的指标当作当前数字 |
| Meta | `platform_oauth_connections` | 已连接元数据 | provider=meta，账号元数据更新 2026-09-03 | `client_id` | 广告、线索、受众和内容表现 | 账户混用/归属风险已在既有审计记录；本轮不执行广告动作 |
| 邮件 / CRM | Microsoft mail 元数据、既有 CRM 表 | 已连接元数据 | `bdm@` 与 `info@` 连接均更新 2026-09-10 | `client_id` | 询盘、跟进、销售阶段 | 尚未形成按 Tour / 出发团聚合的成交事实 |
| CMS / 官网 | `cms_connections`、客户官网 | 记录存在但质量异常 | CTS client_id 下出现 Oztop URL 与 `chinatravel` repo 记录 | `client_id` 记录不可信 | 站点、内容、转化入口 | 必须先修正/隔离连接归属；不能把这两条记录当 CTS 事实 |
| 竞品官网 | Apify → `market_snapshots` / `market_evidence` | 已连接且有真实证据 | 21 次 CTS Web Intelligence runs；最新完整快照 2026-09-10 | `market_* .client_id`，对象域名来自既有名单 | 产品、价格、促销、档期、余位、包含项目 | 目前核心可监控页面只有 Wendy Wu 3 个 URL |
| 竞品变化解释 | `market_signals` | 已连接 | 6 条信号；最新 2026-09-10；5 条 complete、1 条 failed | `market_signals.client_id` | 变化、威胁/机会/忽略 | 解释仍是竞品单方变化，不等于 CTS 受到影响 |
| Industry Baseline | `baseline_domains` | 已连接 | 42 条 active 竞品/行业域名，最新采集 2026-09-09 | `sub_industry` + `is_client`；需通过客户域名归属 | SEO 基础比较、行业参照 | baseline 不是 CTS 产品目录，也不是核心竞品名单 |
| 口碑 | `reputation_snapshots` | 代码有读路径 | 本次未宣称有可比 CTS/竞品快照 | identity + `client_id` | 评分、评价量、近期口碑 | 需确认双方同平台身份和新鲜度 |
| AI 可见度 | `ai_visibility_snapshots` / GEO 基线 | 代码有读路径 | 本次未宣称有最新可比结果 | `client_id` | AI 推荐与引用表现 | 需最新运行、模型范围和竞品身份 |
| Tour 目录、日期、余位、包含项目 | CTS 外部 `chinatravel` 站点代码 / 未来受控连接 | **未连接到 ME 数据库** | 不能从 `master_briefs.products` 推出 | 当前没有 ME 内可靠 `client_id` 事实表 | 逐 Tour 匹配、库存压力、销售窗口 | 本轮最关键缺口；不得用网站文档或模型猜测填充 |
| 成本 | `web_intelligence_runs`、预算 RPC | 已连接 | 21 次运行；每次有 reserved/accounted 字段 | `client_id` + run | 成本归属、NZ$30 目标、NZ$50 hard stop | Inngest signing/event key 未在本地 `.env.local` 配置，自动链路环境不完整 |

## 环境状态（只报告变量名）

已存在：Supabase URL/anon/service-role、OpenAI、Anthropic、Apify、DataForSEO 登录信息。

缺失：`INNGEST_SIGNING_KEY`、`INNGEST_EVENT_KEY`、`WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS`、`APIFY_TOKEN`（代码还使用 `APIFY_API_KEY`）。密钥值未写入本文件、未提交仓库。

## 审计结论

1. Agent 已知道 CTS 是新西兰市场、当前项目方向是中国团，且有真实历史目标和客户画像。
2. Agent **还不知道 CTS 当前具体卖哪些 Tour、价格、档期和余位**；因此任何调价、促销或“某团更值得推”的结论都必须停在 `UNKNOWN`。
3. Wendy Wu 侧已有真实产品证据：Wonders of China，17 天，页面显示 `From $9,030PP`，2027/28 Earlybird，另有出发日期、`Only N Spaces Left` / `SOLD OUT` 等观测。它只能作为竞品事实，不能自动成为 CTS 的对照对象。
4. CMS 连接归属异常属于客户数据隔离风险，建议单独按 A 级修复；本轮不写入生产、不修改连接记录。

## Reuse Statement

- 复用：既有 `clients` / `master_briefs` / `goals`、竞争者 resolver、Industry Baseline、Web Intelligence、Apify、Evidence、Memory、Reports 和 IMPACT 语义。
- 新增共享逻辑：只新增通用的经营证据契约和“可比 / 范围外 / 证据不足”展示规则。
- 行业特定：Tour 对位字段和中国目的地范围使用既有 ME Travel profile。
- 客户特定：CTS 目标、客群、产品缺口、竞品配置和本次事实结果只在客户上下文/审计文档中出现。
- 没有把 CTS 名称、客户 ID、产品数字或客户判断写进共享规则；运行时通过 `client_id` 读取。
- 本轮没有将任何客户学习升级到 industry/global memory。
