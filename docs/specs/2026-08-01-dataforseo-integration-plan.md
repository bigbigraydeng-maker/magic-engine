# DataForSEO 接入计划 · 数据地基扩容 · 分阶段 spec v0.3

> 起草:子牙 · v0.1 2026-08-01 · v0.2 2026-08-01(魏征审后修订) · **v0.3 2026-08-01(PM 提出真客户/调研区分 → 新增阶段 0)**
> 审查沿革:v0.1 → 魏征挑刺 **needs_rework**(5 必修:抓取/成本口径矛盾、标准队列迁移路线被自家脚注推翻、"死表"其实月报在读、竞品占位抓了没落表、前后数字打架)→ v0.2 全部吸收 → v0.3 补阶段 0(真客户闸门)
> 对外大白话名:**「Keyword Intelligence」**(封装名,UI/报告/客户交付物禁止出现 DataForSEO 真名)
> 状态:spec · 未实现任何代码 / 表 / cron
> 数据来源声明:全部单价来自 DataForSEO 官方计价页(逐条附 URL);仓库/数据库事实来自 2026-08-01 只读盘点(魏征抽查 13 处全验);**无一个数字是编的**,标注「上限假设」处除外

---

## 0. 一句话

**ME 已经买了一整套军火库,但只开了两个箱子(Labs + SERP)。口碑和竞品两根支柱至今裸奔,而补齐它们的数据每月只要二十来美金——真正的工作量在管道和 UI,不在钱。**

---

## 1. 现状:已在用什么(不用动的部分)

盘点自 `src/lib/dataforseo/`(2026-08-01):

| 模块 | 端点 | 用在哪 | 状态 |
|---|---|---|---|
| **Labs API** | ranked_keywords / keyword ideas / suggestions / bulk volume / domain metrics / keywords gap / traffic estimation | 关键词情报、seo-gap、张骞 Discovery、华佗、周一 keyword-snapshots cron | ✅ 主力 |
| **SERP API (organic)** | `getSerpPage`(`serp.ts`,Live advanced 端点,已解析 `ai_overview_text` / `ai_overview_sources` / `local_pack`,depth 硬编码 10) | **仅行业级** industry-ai-visibility(每日 cron)+ 张骞 serp-coverage | ✅ 但只用了一半 |
| **Backlinks API** | `getBacklinkSummary`(live) | 仅诊断 collector 单点实时调用 | ⚠️ 有函数无管道 |
| **Business Data API** | `getGmbInfo` / `getGoogleReviews` / `getTripadvisorInfo` | 仅张骞 `fetch_local_reviews` 工具,**不落库** | ⚠️ 有函数无管道 |
| **OnPage API** | `getOnPageInstant` | prospecting 审计 + 张骞 | ✅ 单点用(内链图已拍板自研爬虫,**不扩** OnPage) |
| **Domain Analytics** | 技术栈探测 / WHOIS | 张骞 | ✅ 单点用 |

env:`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`(Render 已配,`render.yaml:58,60`)。

### 1.1 规模乘数(2026-08-01 生产库实测,魏征复核)

| 量 | 值 |
|---|---|
| 客户总数 | 25 |
| 配了 primary_keywords 的客户 | 6 家 / 共 35 词 |
| 配了 competitor_domains 的客户 | 7 家 / 共 43 域名 |
| 周一 keyword-snapshots cron | 每周 1,301 行 / 14 客户 / 1,135 不重复关键词 |
| `keyword_snapshots.local_pack_rank` 近 30 天非空行 | **0**(字段建了,cron 从不传值,也无人读) |
| `clients` 表 GBP/place_id/评价类字段 | **0 个** |
| `local_serp_rankings` 表 | 8 行 2026-05 旧数据,**月报 `collectLocalVisibility` 仍在读它**(见阶段 1) |

### 1.2 官方计价模型(来源:https://dataforseo.com/pricing)

纯按次付费,充值买余额(最低 $50),余额不过期。同一端点三档:Task 标准队列(分钟级,最便宜)→ 优先队列(约 ×2)→ Live(秒级,约 ×2~3.3)。

**本计划全部阶段首版统一走 Live**:量小(全加起来每月几千次调用)、现有代码全是 Live 路径、省去异步 task_post/task_get 的工程量。标准队列迁移**不作为省钱路线写入**——对阶段 1 而言标准队列拿 AI Overview 需 `load_async_ai_overview` 附加费 $0.002/词,加上底价反而比 Live 贵(魏征 ❌2)。

### 1.3 已付学费(红线,来自 memory)

竞品打分批量 cron 曾每月烧 **US$360**,罪魁是 SERP `depth=100`(占 75% 成本),已停。→ **本计划所有 SERP 类调用 depth 一律默认 10,禁止超过 20;新 cron 一律先算月账单再上线。**

---

## 2. 全家族盘点(还有什么没开箱)

来源:https://docs.dataforseo.com/v3/

| 家族 | 能干什么 | 对 ME 的判断 |
|---|---|---|
| SERP API | Google/Bing/YouTube 等搜索结果页 | ✅ 在用,**待深挖**(AI Overview / local pack 白送没接) |
| **AI Optimization API** | AI Keyword Data(AI 搜索量)+ LLM Mentions(品牌在 LLM 回答中被提及)+ LLM Responses(直调 ChatGPT/Claude/Gemini/Perplexity) | 🆕 GEO 第二战场专用弹药,**候选** |
| Keywords Data API | Google Ads 搜索量/趋势 | Labs 已覆盖同类需求,不接 |
| DataForSEO Labs | 关键词研究/竞品分析 | ✅ 主力,不动 |
| **Backlinks API** | 外链/referring domains/新增流失时序 | **候选**(表都建好了) |
| OnPage API | 爬站技术审计 | ❌ 已否决(内链图自研爬虫,PM 拍板,不再提) |
| Content Analysis API | 全网提及/情感分析 | 暂缓(口碑支柱先用评价数据,提及监测二期) |
| Merchant / App Data | 电商/应用商店 | 无对应客户,不接 |
| **Business Data API** | GBP 档案 + Google/Trustpilot/Tripadvisor 评论 | **候选**(口碑支柱 0→1) |
| Domain Analytics | 技术栈/WHOIS | ✅ 在用,够了 |
| Databases | 批量数据库买断 | 规模不到,不接 |

---

## 3. 四候选打分

打分口径:客户价值(对 CTS/Oztop 等真实客户的直接可感知价值)/ 接入成本(工程量)/ 月度花费(按 §1.1 实测规模 × Live 档算,与 §4/§5 同一套数,单价全部官方可溯)。

| 候选 | 支柱 | DAPE 段 | 客户价值 | 接入成本 | 月花费(Live) | 结论 |
|---|---|---|---|---|---|---|
| ① SERP 深挖:AI Overview + local pack + 前 10 占位落库 | AI 可见度 + SEO + 竞品 | D 发现 + A 分析 | ⭐⭐⭐⭐⭐ 三样都是现有 SERP 结果**自带**的,解析代码都写好了,纯捡钱 | 低(改 1 个 cron + 新 1 表 + 补读取方) | **≈US$10** | **第一阶段** |
| ③ Business Data:客户+竞品评价监测 | 口碑(目前最薄) | D 发现 + A 分析 | ⭐⭐⭐⭐⭐ 口碑支柱从"只有一个分数"到"有明细、有趋势、有竞品对比" | 中(新表 + clients 配置字段 + **Settings UI 强约束**) | **≈US$1.5(上限假设)** | **第二阶段** |
| ② Backlinks 周报 | SEO + 竞品 | A 分析 + D 发现 | ⭐⭐⭐⭐ 外链得失进 S18 周报;竞品外链对比是 FDE 谈资 | 低-中(表已建,补 cron + 读取方) | **≈US$6.5(上限 14)** | **第三阶段** |
| ④ AI Optimization:Google AI Mode + LLM Mentions | AI 可见度 | D 发现 + A 分析 | ⭐⭐⭐ 增强 GEO 叙事;但客户级 AI Tracker 已自建 4 引擎,边际价值待验证 | 中 | **≈US$1.5(试点;铺开另议)** | **第四阶段(先试点后铺开)** |

> 单价来源(Live 档口径):organic SERP Live $0.002/页、异步 AI Overview 附加 $0.002(没出则退款)——https://dataforseo.com/pricing/google-serp/google-organic-serp-api;GBP 档案 $0.0015(标准)、Google 评论 $0.00075/10 条(标准;Business Data 官方页未列 Live 价,按标准队列计)——https://dataforseo.com/pricing/business-data/business-data-api 、https://dataforseo.com/pricing/business-data/google-reviews-api;Backlinks(仅 Live)$0.024/请求+$0.000036/行——https://dataforseo.com/pricing/backlinks/backlinks;Google AI Mode Live $0.004——https://dataforseo.com/pricing/google-serp/google-ai-mode-serp-api;LLM Mentions $0.1/请求+$0.001/行——https://dataforseo.com/pricing/ai-optimization/llm-mentions

---

## 4. 分阶段接入安排

### 阶段 0 · 真客户闸门(前置,PM 2026-08-01 提出,不花 API 钱)

**问题(PM 陈述 + 库中证实)**:`clients` 表里真客户只有 **8 家**——外部 5 家:CTS、Oztop、Roman Hu、30 Kiteroa(Roman 销售的楼盘)、Parkhomes(开发商,Roman 负责销售,ME 负责整体推广);自有品牌 3 家:Magic Lab Class、Magic Lab、Magic Engine(PM 2026-08-01 确认;**Magic Engine 目前库里无档案,阶段 0 落地时一并建**)。其余全是 PM 在后台跑 Discovery 产生的**潜在客户/调研档案**(后台建档的原因:前台 Discovery 表格不够完整)。表里没有任何字段区分两者,现有 cron 选客户条件是 `domain IS NOT NULL`——**今天每周排名快照已在给 14 家跑,其中过半是调研壳子,钱和算力一直在白烧**,新计划若不设闸门会把浪费成倍放大。

**做什么**:
1. `clients` 加 `client_status` 字段(`active` 真客户 / `prospect` 调研·默认值 / `archived`)——migration,**必 PM go apply**
2. Settings 页加状态开关(强约束:配置必带 UI,PM 不碰数据库)
3. **所有周期性监测 cron(含现有 keyword-snapshots-weekly / ai-tracker-weekly,以及本计划阶段 1-4 全部新 cron)选客户条件统一改为 `client_status = 'active'`**;张骞 Discovery / prospecting 的一次性调用**不受影响**(它们本来就该对调研档案跑)
4. 数据回填:8 家真客户标 `active`(Magic Engine 先建档),其余标 `prospect`。✅ Parkhomes 重复建档已于 2026-08-01 并档:保留域名正确的 `19e025b7`(名字已改为 "Parkhomes"),删除错域名(parhomes.nz)的旧档及其 3 条废 Discovery 记录

**喂给谁**:所有监测 cron 的成本闸门 + 后台客户列表可按状态过滤(真客户/调研分开看)。

**月成本**:0(纯工程,反而立刻省下现有 cron 里 9 家壳子的白烧)。

---

### 阶段 1 · SERP 深挖:把已经付钱买到的数据捡回来(AI 可见度 + SEO + 竞品支柱,D/A 段)

**接什么**:每周对**全部追踪关键词(≈1,135 词,即 keyword_snapshots 全量口径;按 keyword+location_code 去重)**跑一次 SERP API organic Live advanced,把结果里**本来就自带**的三样东西落库:
1. `local_pack_rank`(字段 5 月就建好,`buildKeywordSnapshotRows` 第 4 参预留好,cron 从没传过——`src/lib/seo-intelligence/keyword-snapshots.ts:60,93`)
2. AI Overview 出现与否 + 客户/竞品是否被引用(客户级空白;行业级 `industry-ai-visibility` 已验证同一套解析,`src/lib/industry-ai-visibility/collector.ts:139`)
3. SERP 前 10 的 organic 域名占位(喂竞品支柱,落表和读取方见下,魏征 ❌4 补齐)

> 口径说明(魏征 ❌1):v0.1 曾写「primary_keywords + position≤20」(≈830 词),v0.2 改为**全量 1,135 词**——差价每月约 $2.6,换来口径唯一、无需维护第二套筛选逻辑,且全量数就是成本上限。

**技术路径**:复用 `getSerpPage`(`src/lib/dataforseo/serp.ts`,解析全现成)。新增每周 cron `serp-capture-weekly`(或并入 keyword-snapshots-weekly 第二步),**depth=10 硬顶,首版不开 `load_async_ai_overview`**(首月观察同步出现率,不够再开,开了成本上限翻倍见 §5)。

**落哪张表**:
- `keyword_snapshots.local_pack_rank` — 已存在,补写入 + 补读取(`getLatestKeywordSnapshotForClient` 的 select 列表加上它——现在不含,153 行)
- 新表 `serp_ai_overview_snapshots`(client_id, keyword, location_code, snapshot_date, has_ai_overview, client_cited, cited_sources jsonb, **top_organic_domains jsonb**)— unique 约束 `(client_id, keyword, location_code, snapshot_date)` 照抄 keyword_snapshots 的 onConflict 模式;RLS 一律 service-role 模板(CLAUDE.md 强约束)

**喂给谁(每样数据点名读取方,不落空)**:
- local_pack_rank → 盯梢新规则「local pack 掉出前 3」→ 诸葛亮 action card;**月报 `collectLocalVisibility`(`src/lib/reports/monthly-aggregator.ts:450`)改读此字段**——它现在读的是 8 行旧数据的 `local_serp_rankings`,一直半死不活,这是现成读取方白捡闭环(魏征 ❌3)
- AI Overview 快照 → 盯梢新规则「AI Overview 从引用变不引用」;S18 周报 AI 可见度栏;华佗 ai_visibility 打分从"行业级抽样"升级为"客户自己关键词实测"
- top_organic_domains → 盯梢新规则「竞品新进前 10」;S18 周报竞品栏;competitors-gap 面板少打一次实时 Labs 调用

**cron 频率**:每周一(与 keyword-snapshots 同日,数据同源同鲜度)。

**月成本(可溯算式)**:1,135 词 × 4.33 周 × $0.002(Live,含同步 AI Overview 与 local pack)= **US$9.83/月**。

---

### 阶段 2 · 口碑支柱 0→1:客户 + 竞品评价监测(口碑支柱,D/A 段)

**先修身份地基(本阶段最大的工程量,不是 API)**:
- `clients` 表加 GBP 身份字段(place_id / cid),**连同 Settings 页 UI 一起交付**(CLAUDE.md 强约束:FDE 配置类数据必须有 UI,复用 chip+input 模板 + 对称 GET/PATCH 路由)。竞品的 GBP 身份挂在 competitor_domains 旁边同页配置

**范围铁律(魏征 ⚠️2)**:本阶段**只做**身份字段 + Settings UI + 快照落库。现状里"诊断走 Google Places API、张骞走 DataForSEO"两条 GBP 路的统一(即 `reputation-collector` 切源)**不在本阶段**——那动的是华佗 reputation 打分的生产路径,拆独立 PR、独立回归(`scoreReputation` 有现成测试,切源前后对比分数漂移),等快照数据跑稳一个月再做。

**接什么**:每周拉客户 + 竞品的 GBP 档案(评分/评论数)+ 增量评论明细;CTS 加 Tripadvisor(`getTripadvisorInfo` 现成)。

**落哪张表**:新表 `reputation_snapshots`(entity_type client|competitor, client_id, source gbp|tripadvisor|trustpilot, rating, review_count, snapshot_date)+ `review_items`(评论明细:author, rating, text, review_date, is_new)。现状**没有任何评价明细表**(全库唯一 review 表是内部项目评审)。

**喂给谁**:`scoreReputation()` 从"实时现拉、无历史"变成读快照(函数已预留 tripadvisor/productReview 字段,零改动接驳);盯梢新规则(差评出现 / 评分跌破阈值 / 竞品评论增速超过我)→ 诸葛亮 action card;S18 周报口碑栏;司马徽 Discovery(竞品口碑异动 = 主动发现素材)。

**cron 频率**:每周。差评告警未来可升每日(成本允许)。

**月成本(可溯算式,上限假设)**:按 68 商户(25 客户 + 43 竞品)全部配好 GBP 身份、每商户每周 30 条增量评论计:档案 68 × 4.33 × $0.0015 = US$0.44;评论 68 × 4.33 × 3 × $0.00075 = US$0.66 → **合计 ≈US$1.5/月**。两个前提都是高估(首月实际配好的商户远少于 68;中小客户周增 30 评论偏多),真实账单只会更低(魏征 ⚠️1)。

---

### 阶段 3 · Backlinks 周报:表已建好,补管道(SEO + 竞品支柱,A/D 段)

**接什么**:每周每客户拉 backlinks summary + new & lost timeseries;竞品域名**每月**一次 summary(频率降一档控成本)。

**落哪张表**:全部**已存在**(`supabase/migrations/20260501000004_dataforseo_backlinks.sql`,魏征已验证产线真建了,`backlink_velocity` 存量 2 行):`backlink_velocity`(周快照)、`backlink_data`(明细)、`competitor_backlinks`(目前零读零写)。唯一写入方是一次性脚本 `scripts/sync-p8.ts`——补成正式 cron 即可,**不需要 migration**。

**喂给谁**:S18 周报外链栏(得/失/净增);诊断 `low_referring_domains` finding 从实时单点调用改读快照;`competitor_backlink_gap` finding(类型已定义在 `src/types/diagnostic.ts:81`,产出规则一直缺失——本阶段补上);月报 `monthly-aggregator` 已在读 `backlink_velocity`(365 行),数据一通它就活了。

**cron 频率**:客户每周,竞品每月。

**月成本(可溯算式)**:Backlinks 仅 Live 模式,$0.024/请求+行费。客户:25 × 4.33 × 2 端点 × ≈$0.025 = US$5.4;竞品:43 × 1 × $0.025 = US$1.1 → **合计 ≈US$6.5/月**(明细行拉满 1,000 行时单请求 $0.06,上限情形 ≈US$14/月)。

---

### 阶段 4 · AI Optimization 试点:GEO 第二战场加深(AI 可见度支柱,D/A 段)

**接什么(先试点,不铺开)**:
1. **Google AI Mode SERP**(独立端点 `/v3/serp/google/ai_mode/`):对 6 家配了 primary_keywords 的客户,每周每客户 10 问。**问句来源:AI Tracker 现成问句库 `ai_visibility_queries`**(每客户已有生成好的地域化问句,不新造)(魏征 ⚠️4)。AI Mode 是 Google 的 LLM 问答形态,是 AI Overview 之后的下一个战场
2. **LLM Mentions 评估**:先给 CTS 一家跑 4 周,对比自建 AI Tracker(4 runner)的结果差异,再决定是替换自建 runner(省 OpenAI/Anthropic/Perplexity API 钱 + 维护)还是不接

**试点第一步 = schema 适配验证(魏征 ⚠️3)**:LLM Mentions 返回的是"提及率/榜单"形状,与 `ai_visibility_runs` 的"单问单答"形状**不一定同构**——先拿真实返回 payload 对照三表,塞不进就单独建表,不硬套。

**落哪张表**:AI Mode 走客户级 AI Tracker 三表;`ai_visibility_runs.ai_engine` CHECK 约束加值(DROP + ADD 两步)属 migration **必 PM 拍板**;前端影响面实测 10+ 文件(`src/types/magic-engine.ts` + dashboard + 4 个 diagnostic route)——**enum 加值必 grep 全仓同步 type + UI fallback**(CLAUDE.md 强约束)。

**喂给谁**:AI Tracker 面板 + GEO Composer 选题(哪些问题客户缺席 → 双信号内容飞轮的 GEO 信号侧)。

**cron 频率**:每周,与 ai-tracker-weekly 同班车。

**月成本(可溯算式)**:AI Mode Live:6 客户 × 10 问 × 4.33 × $0.004 = **US$1.04/月**;LLM Mentions 试点:CTS 每周 1 请求 × 4.33 × ($0.1+行费) ≈ **US$0.5/月**。**试点期合计 ≈US$1.5/月**;铺开到 25 客户每周 LLM Mentions 才到 ≈US$11/月——铺开与否等试点数据说话。

---

## 5. 总账(给 PM 的那一个数)

| 阶段 | 月增成本(Live 档,与 §3/§4 同一套数) |
|---|---|
| 0 真客户闸门 | 0(反而省现有 cron 的白烧) |
| 1 SERP 深挖 | US$9.8 |
| 2 口碑监测 | US$1.5(上限假设) |
| 3 外链周报 | US$6.5(明细拉满时 14) |
| 4 AI 试点 | US$1.5(铺开另议) |
| **合计** | **≈US$19/月;全部上限情形(外链明细拉满 + 阶段 1 开异步 AI Overview 参数再 +$9.8)≈US$33** |

**给 PM 的一句话:每月大约多花 20 美金、封顶 30 出头,是当年白烧那个 cron(US$360/月)的零头。**

> ⚠️ 上表按库里全部客户量算,是**上限**。阶段 0 落地后所有监测只对 5 家真客户跑,真实账单显著低于此数(阶段 1 的 1,135 词里含 9 家调研壳子的词,过滤后自然缩水)。

---

## 5.1 spec 版本沿革

- **v0.2 → v0.3(2026-08-01)**:PM 指出 clients 表混着真客户和 Discovery 调研档案 → 新增**阶段 0 真客户闸门**(client_status 字段 + Settings UI + 全部监测 cron 过滤);PM 确认真客户名单 8 家(外部 5 + 自有品牌 3);总账标注为上限口径;Parkhomes 重复档案已并(留 19e025b7,删错域名旧档)。

---

## 6. 不做清单(明确否决,别再提)

1. **OnPage API 扩面** — 内链图已拍板自研爬虫(2026-07-31),否决
2. **Keywords Data API** — Labs 已覆盖搜索量/建议词,重复
3. **Merchant / App Data / Databases** — 无对应客户形态
4. **Content Analysis API** — 口碑支柱先吃评价数据;全网提及监测等阶段 2 跑顺再议(二期候选)
5. **SERP depth>20 / 任何未算月账单的新 cron** — US$360 学费红线
6. **标准队列迁移作为省钱手段** — 对含 AI Overview 的抓取反而更贵(§1.2),不立此路线

## 7. 工程红线(实施 worker 必读)

1. 新表 RLS 一律 service-role 模板;migration 必 PM 拍板,worker 严禁自行 apply
2. `ai_engine` 等 enum/CHECK 加值必 grep 全仓同步前端 type + UI fallback
3. 所有配置字段(place_id/cid 等)必须连 Settings UI 一起交付,禁止"PM 进 Supabase 直填"SOP
4. UI/报告一律封装名 Keyword Intelligence,不出现供应商真名
5. 每个新 cron 上线前:算月账单写进 PR 描述 + `render.yaml` 登记 + link `me-shared-cron-secret` env group(daily-cron-digest 哑 51 天的教训:sync:false 不自动填值)
6. **每阶段上线第一周,用 DataForSEO 后台真实账单对账,实测单价回写本 spec**(魏征 ⚠️5:官方页价 ≠ 实测账单前,数字只算"官方可溯"不算"实测")
7. 阶段 1 优先复用 `getSerpPage` / 阶段 2 复用 `business-data.ts` / 阶段 3 复用 `getBacklinkSummary`——先查平台再建,别造平行系统
8. 每样落库的数据必须点名读取方(§4 已逐项点名);抓了没人读 = 白花钱,是 ME 的惯性病

## 附录 A · 待 PM 决定的遗留物

- `local_serp_rankings` / `local_ranking_history`(8 行 2026-05 旧数据):**月报 `collectLocalVisibility`(monthly-aggregator.ts:450)在读前者,不是死表**。阶段 1 将其改读 `keyword_snapshots.local_pack_rank` 后,两张表才真正无读者,届时删表(migration,需 go apply)必须**连同旧读取路径一起清理**,防月报栏静默变 null
- `searchBusinessListings`(business-listings.ts)已实现零调用方:保留(prospecting 潜在用途),不删
