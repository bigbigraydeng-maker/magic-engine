# SEO Agent（广告 Agent 体系的 SEO 技能）设计 v0.2

日期 2026-10-21 ｜ 作者：95 号（SEO）｜ 来源：74 号转 PM 10-21 要求 ｜ 状态：**草案，待 98 / 73 对表**（见文末「待对表」）；74 号 10-21 已确认定位、阈值初值、R3 只 dry_run、R5 暂缓、合同以 119 为准。v0.1 → v0.2：吸收子牙 + 魏征各一次设计审（均「有条件通过」）；**最大改动 = 定位更正：SEO Agent 不是新东西，是现有 SEO Agent 体系多一个「接广告请求」的入口**。
上游：`docs/specs/2026-10-21-ad-agent-system-v1-architecture.md` §3–§4（74 号本地提交 827a49654，尚未进主干）。

## 0. 读了什么、定位是什么

读过：`playbook-seo-general.md`（取数纪律、信息完整闸门、说「有效」前三关、北极星是整站曝光点击）；仓库内**已有的 SEO Agent 体系**（v0.1 漏看，子牙审查时指出）：
- `docs/sops/2026-10-11-seo-agent-playbook-and-rules-v1.0.md`（73 号：平台—行业—客户三层规则手册，授权四档，保护页）
- `docs/sops/2026-10-14-seo-agent-workflow-and-goal-plan-v1.md`（73 号：IMPACT 周闭环、**决策权表**、偏离预设动作；排期归 98 号）
- `docs/specs/2026-10-04-seo-goal-plan-daily-loop-v0.1.md`（目标—计划—每日循环，含计划器的页面互斥）
- `docs/specs/2026-10-12-seo-protected-pages-unified-gate-a1-v0.1.md`（A1 保护页统一闸，`PageWriteGuard` 已在 `src/lib/seo/protected-pages.ts` / `system-page-guard.ts`）

**定位（需 98 / 73 对表确认）**：
- **只有一个 SEO Agent**。广告体系里的「SEO Agent」= 这个 Agent 的**请求入口 + 回执**：广告 Agent 的搜索词 / 着陆页数据以 `seo_request` 进来，**变成现有周清单 / 计划器里带证据的计划项**，不另开第二个派活入口（避免两个入口派同一页）。
- 分工：98 号排期与验收；73 号规则与手册；**95 号 = 广告请求入口（本稿）**；代码里的常驻 agent（标题周循环、rank sampler、GSC 存档）不变。
- **决策权沿用 10-14 手册 §3**（PM 2026-10-14：「细节别问我」）：非保护页的 B/C 级改动 = 出草稿 → 独立审查 → 检查全绿 → 合并 → 事后汇报；保护页 / 花钱 / 业务事实 / A 级才问 PM。**本稿不另立一套审批。**
- 但 74 / PM 10-21 对本 Agent 另给了更严的红线（§5）：**客户官网文案改动先 `dry_run` 给 PM 看**；有流量页面不做大改。新入口先按这条更严的跑，跑稳后再回到 10-14 的事后汇报。

平台层级（Inline）：归位既有 SEO 支柱（L1），不新增支柱 / 能力线 / 数据源 / 供应商；请求合同与闸门 = 平台通用；「团页 / 指南 / 广告落地页」分工 = 旅游行业 Playbook 候选（L2）；CTS 的词归属、受保护页、追踪词 = 客户配置（L4，`clients.seo_config`）。

## 1. 现有 SEO 管线哪些直接就是能力

| 能力 | 现成位置 | 用法 | 状态 |
|---|---|---|---|
| 关键词量 / 难度 / SERP | `src/lib/dataforseo/`（`bulkKeywordVolume`、`getOrganicRanks`、`getSerpPage`） | 请求里的词先查量 + 难度；名次一律 `getOrganicRanks`（organic rank_group，参数固定，深度写进回执） | 直接用 |
| 周名次快照 + 指定追踪词 | `keyword-snapshots-weekly`、`seo-intelligence/watch-keywords.ts`（`seo_config.rank_watch_keywords`，PR 2555 已上线并写入 CTS 配置） | 各团核心词进追踪词；名次三态（有名次 / 前 100 外 / 没测成）分开 | 直接用 |
| 名次判定与对账 | `seo-meta/cycle/rank-sampler.ts` / `rank-verdict.ts`：**第 18 天起首次采样，至少 3 个有效样本，名次移动 ≥ 3 位才算信号**（`FIRST_SAMPLE_AFTER_DAYS=18`、`MIN_VALID_SAMPLES=3`、`MIN_RANK_MOVE=3`） | 建议被采纳后的对账；三态：动了 / 没动 / 没测成，不写因果 | 直接用（**对账时点以此为准，不是 T+7/T+14**） |
| 发布后复查 | `lib/seo/post-publish-monitor.ts` + Inngest `seo-post-publish-monitor`（T+72h / T+7d，事件前缀 `seo/page-watch.*`）+ `config/clients/cts/post-publish-watch.json` | 页面上线后的收录 / 页面健康复查，**沿用其事件和时点**，不另造 | 直接用 |
| GSC 页级 / 词级 | 库内 `gsc_page_daily`、`gsc_query_page_daily` | 广告落地页对应的自然搜索表现、同词被哪几页分食 | 直接用（`fetchGscQueriesForPage` 的密钥只在 Render → 需要它的步骤必须是服务端 Inngest 函数） |
| 保护页统一闸 | `lib/seo/protected-pages.ts`（`createPageWriteGuard`）、`system-page-guard.ts`、名单 `seo_config.meta_cycle_protected_slugs` | 红线「保护页不自动改」的机器版；**坑**：裸 slug 只匹配 URL 最后一段，名单上限 `MAX_PROTECTED_ENTRIES=50`（超出整张名单作废）→ 台账与名单一律写**含 `/` 的全路径**并占名额预算（手册 P-02a 已登记此缺口） | 直接用 |
| 信息完整闸门 | `seo-meta/cycle/gate.ts`（`GATE_REASON`、`runGateForCandidate`） | 改文案类建议必须过：量+难度齐 / 实时 SERP 前 3 / SERP 里排名的是这一页 / 词含主题词 / 90 天不重复 / 与原文事实不矛盾 | **不是小改**：入口绑定周循环候选对象和 `MetaCycleClientConfig`，且含只适用于仓库数据文件页的 `slug_not_in_any_data_file`；**v1 要先拆出与候选解耦的闸门入口**，再让请求调用 |
| 巡检 / 机会 | `seo-patrol/`、`seo-intelligence/{competitors-gap-cache,keyword-opportunity}.ts` | 「发现」「内容缺口」类数据来源 | 直接用 |
| 事件 + 回执 + 待办 | Inngest、`cron_run_logs`、`pm-todo` pusher | 请求 = 事件，回执 = 结构化记录，人工项 = 待办 what/how/href | 直接用 |

**缺口（只有这几样要新建）**：①广告搜索词 / 着陆页数据的入口（由广告 Agent 打进请求，SEO 不自己拉广告账户）；②词归属台账 + `ownership_check` 纯函数（§3）；③请求 / 回执落库（用 119 统一定义的表）；④站点地图 / canonical / noindex 自动体检（现只能人工 curl；`gsc/sitemap-ping.ts` 的 ping 已被谷歌停用，不可复用，`system-page-guard.ts` 是写入守卫不是体检）。

## 2. 接口：`seo_request` 与回执

**合同以 119 的 `src/lib/ad-agent/contract` 为唯一权威**（74 号 10-21 确认）：`seo_request` / `seo_receipt` 的字段名和事件名由 119 定，**本稿只引用，不另定**；下面只是 SEO 侧**需要哪些信息**的清单，供 119 对表（写稿时该目录尚未进主干，未核对）。**回执落库用 122 的 `agent_request_receipts`（追加式）**，不另建表；事件前缀建议与仓库现有 `seo/…` 斜杠风格一致，由 119 / 122 定。

**seo_request（广告 Agent → SEO Agent）**
```
request_id (唯一键；幂等：并发重发由请求表对 request_id 的唯一约束兜底，只回同一份回执)
client_id, tour_slug   // tour_slug 以 config/clients/cts/offerings.yaml 的 code 为准；若 121 团数据 slug 不同，由 119/121 给映射表，不新建第三份
kind        keyword_gap | page_intent_check | cannibalization_check | page_text_suggestion | content_gap
evidence    { data_through, window_days:[30,14,7],
              search_terms:[{term, impressions, clicks, cost_nzd, leads, sample_n}],
              landing_pages:[{url, sessions, leads, cost_nzd, sample_n}] }   // 样本量必填；没有样本量的数字不收
scope       { urls?, terms? }
constraints { promo_window:{start,end}, no_publish:true }
asked_at, requested_by
```
**seo_receipt（SEO Agent → 广告 Agent / 网站 Agent / 待办）**
```
request_id, client_id, created_at, status: answered | blocked | rejected | superseded
blocked_reasons  沿用 gate.ts 的 GATE_REASON（no_page_scoped_keyword_match | keyword_data_unavailable | keyword_reused_by_another_page_90d |
                 serp_shows_different_own_page_ranking | difficulty_above_floor | slug_not_in_any_data_file | protected_conversion_page）
                 + SEO Agent 只新增 sample_too_small、request_data_missing（实施前核对 GATE_REASON 全集）
recommendations  [{ id, type, target_url, proposed_text?, evidence_refs[], gate_result{vol,kd,serp_top3_fetched,owner_page,reuse_90d},
                    risk, executor, needs_pm_approval, approval_ref?{approver, at}, reason_if_no_change? }]
cost             { provider:'DataForSEO', usd }
data_as_of       { gsc_through, dataforseo_fetched_at }
no_publish       true   // 永远；SEO Agent 不写客户网站
```
- `needs_pm_approval` **由规则算出，不由请求方 / Agent 自报**：命中保护页（含 `protected_conversion_page`）、命中高流量阈值、涉及价格 / 班期 / 业务事实、花钱、A 级 → true；其余按 10-14 手册 §3 走独立审查路径（false）。**批准回执（`approval_ref`）由审批入口（待办 / PM 本人）写入，Agent 自己不能发**。
- 状态机：`requested → answered | blocked | rejected`；`answered` 之后来新证据 → 新 request，旧回执标 `superseded`（不改旧回执）。批准 → 网站 Agent / 现有 PR 通道执行 → 回执 → 登记发布后复查（72h / 7d）→ 名次对账（第 18 天起）→ 「动了 / 没动 / 没测成」。
- **Fail-closed**：没有批准回执 + 执行方回执，不得标「已执行」；取数失败 = `blocked`，不用 0 或借别页的词兜底。

**各建议类型的闸门与批准（合同字段）**

| type | 过词闸？ | `needs_pm_approval` | 执行 |
|---|---|---|---|
| `ownership`（词归属登记） | 量 + 难度齐才登记 | false（内部台账，不动网站） | 95 出表 / 121 对表 |
| `title_meta` | **必过全套闸门** | 保护页 / 高流量页 / 首批（见 §5 流程约定 3）= true | 121（接管页）/ 现有周循环（非接管页） |
| `internal_link` | 不适用词闸；检查链出页 / 链入页归属 | 涉保护页或枢纽页出入链 = true；非保护页按 10-14 §3 | 博客页走现有博客 PR 通道；落在 121 接管页上则 121 写 |
| `structure`：加入 sitemap 等不改语义的修复 | 不适用 | false | 121 |
| `structure`：canonical / noindex / 跳转 / 合并页 | 不适用 | 保护页 = true；非保护页按 10-14 §3，但首批 = true | 121 |
| `new_content` | 必过全套闸门 | 按 10-14 §3（新文章草稿→人合并） | 现有博客 PR 通道 |
| `no_change` | 必须写 `reason_if_no_change`（哪一项闸没过 / 样本不足） | false | — |

「高流量页」阈值是**客户配置项，不写死在代码里**（`seo_config.seo_agent.high_traffic_impressions_28d`，缺省 300），由 SEO 管线从 `gsc_page_daily` 自己算，**不由请求方自报**；**CTS 初值 = 近 28 天曝光 ≥ 300（74 号 10-21 已确认先用）**。

## 3. 与网站 Agent（121）分工：谁改什么、怎样不抢词

**原则：一个词只有一个「正主页」；一个页面只有一个写入者。**

| | SEO Agent | 网站 Agent（121） |
|---|---|---|
| 决定 | 词归属、标题 / 描述 / H1 **建议文本**、内链指向、canonical / noindex / 站点地图的**要求** | 页面结构与区块、结构化数据（JSON-LD）生成、价格 / 班期 / 团数据读取、模板、预览与上线 |
| 写页面？ | **从不写**，只出带证据的建议 | **接管页的唯一写入者**（草稿 + 预览） |
| 数据真相 | 词量 / 难度 / 名次 / GSC | 团数据（班期 / 价格 / 推广期）；SEO 只读，不自建第二份 |

**词归属台账**：唯一来源 = `clients.seo_config.keyword_ownership`（运行时读取，随库配置；**不再另放一份 yaml**，避免两处各存一份）。每行：词 → 正主页（**全路径**）→ 页面角色（hub / tour / guide / blog / campaign）→ 量与难度及取数日期。
**写入者归属**：`seo_config.site_agent_owned_slugs`（全路径）= 「121 接管」的页，**只让周循环跳过**；**不复用 `meta_cycle_protected_slugs`**（该名单在 `gate.ts` 第一步即判 `protected_conversion_page` 终止，复用会让 SEO 对 121 页的所有建议永远 `blocked`）。两键含义分开：protected = 必须 PM 点头；site_agent_owned = 写入者是 121。周循环侧需一处小改（读新键并跳过）。**121 接管哪些页由 121 确认，本稿不替 121 定。**

规则：
0. **谁维护 / 谁裁决**：95 出表、121 对表；冲突先用数据（量、难度、现有名次、内容厚度）裁；**数据裁不了或两边不同意 → 升给 74，由 PM 决定**。
1. **`ownership_check` = 纯函数**，121 新建 / 改页面目标词之前调用；**121 每次页面变更的回执必须带这次检查结果，没有结果按 fail-closed 处理、不许上线**。⚠️ 现有「90 天不重复用词」闸门只查 `seo_meta_log`（周循环改过的页），**对 121 改的页无效**，所以不能当兜底；121 的页面在另一个网站仓库，机器强制只能落在「变更回执缺检查结果就不放行」这一条流程闸上，不是代码闸（诚实局限）。
2. 与计划器的关系：`seo_request` 转成计划项时，计划器已有的「页面互斥」（读 `seo_meta_log` + 保护名单，命中本周不派）继续生效；121 接管页多一条「`site_agent_owned_slugs` 命中则周循环不动」。
3. **广告页 `/campaigns/{团}`**：noindex + canonical 指向团页；不进站点地图；不登记任何自然搜索目标词。体检项（缺口 ④）：每上线一个广告页，核对 noindex、canonical、不在 sitemap。现状：旧广告路径 `/campaigns/october-2026/shanghai-surroundings` 10-21 实测 **308 跳转**到团页。

## 4. 第一刀：总览页与上海团页的第一份「基于数据」的建议

数据口径：GSC 库内 `gsc_page_daily` / `gsc_query_page_daily` 28 天，截至 **2026-10-17**（GSC 平均名次，**不是** SERP 实测，也没有重复取数）；月搜量 / 难度为 DataForSEO `keyword_overview` 单次取数（新西兰，2026-10-20），低量词（≤ 50）不稳；线上抽查 2026-10-19 / 21。**样本很小（多数页 28 天不到 60 次曝光），只能当方向，不能当结论。**

**总览页 `/tours/china/discovery`**（28 天：53 曝光 / 2 点击 / GSC 均排 25.8）
- 库内词级数据里已知的词：`china discovery tours`（11 曝光，3.6）、`china discovery`（6，4.8），合计 17 次，约占 53 次的三分之一，其余词级未入库——**「已知词全是品牌 / 产品名」是对已知部分的观察，不是结论**。
- 大词 `china tours`（NZ 月搜 260，难度 6）、`china tours from new zealand`（210，难度 0）由**受保护的主商业页**在抢（名单里的 `china-tours` 等），总览页**不该去碰**。
- ~~实测总览页不在 sitemap.xml~~ **更正（121 号 10-21 指出，已复核）**：我的抓取在 2026-10-19 10:35 UTC，而 121 在 2026-10-20 00:12 NZDT（= 10-19 11:12 UTC）才把 `/tours/china/discovery` 等三个团型列表页加进 sitemap（提交 21699f6，`/tours/china` 为 00:19、2f43fe0）。我在 2026-10-20 11:36 UTC 重新下载 sitemap.xml：HTTP 200、174 条，含 `/tours/china`、`/tours/china/discovery`、`/tours/china/signature`、`/tours/china/stopover`。**原结论是抓取时间点过早造成的，不成立。**

**上海团页 `/tours/china/discovery/shanghai-surroundings`**（标题「Shanghai & Surroundings Discovery | March 2027 | CTS NZ」，canonical 指自己）
- 上海相关页至少 9 个在分食（28 天曝光）：`/shanghai-travel-guide` 157、`/blog/shanghai-suzhou-hangzhou-itinerary` 174（**0 点击**，GSC 均排 10.0）、`/blog/shanghai-skyline-modern-china` 122、`/blog/first-trip-china-beijing-or-shanghai` 92、`/blog/shanghai-10-days-itinerary` 82、`/explore/shanghai` 69、`/shanghai-tours` 51（22.5）、`/tours/china/stopover/shanghai-express` 52（13.1）、`/shanghai-surroundings-discovery-guide` 52（13.2）。指南 / 博客合计约 **700 曝光 / 28 天**，团页自己几乎没有。
- 头词 `shanghai tour(s)` NZ 月搜只有 **30**（难度取不到）：**头词量很小，方向上看自然搜索很难单独承接这个团的需求（样本不足，只是方向）**；更有价值的做法是「不抢词」+「把指南 / 博客的曝光导向团页」。
- 取不到量的词（`shanghai tours new zealand`、`shanghai tour packages`、`china discovery tours`）按规则写 `keyword_data_unavailable`，**不当 0**。

**建议（全部 `no_publish`）**

| # | 建议 | 证据 | 闸门 | 执行 | PM |
|---|---|---|---|---|---|
| R1 | ~~总览页加入 sitemap.xml~~ **撤销（已由 121 于 10-20 00:12 NZDT 完成，10-20 11:36 UTC 复核在内）** | 见 §4 更正 | — | — | — |
| R2 | 词归属台账初版（**待 121 对表后才算数**）：`shanghai tour(s)` → `/shanghai-tours`（hub）；团页名 / `shanghai & surroundings` → 团页；`things to do in shanghai`（NZ 月搜 480、难度 0，现 GSC 均排 39）→ `/shanghai-travel-guide`；`/campaigns/*` 一律不登记词 | GSC 页级 + DataForSEO 量 | 量 + 难度齐的词才登记 | 95 出表 / 121 对表 | 否（内部台账） |
| R3 | 从 `/blog/shanghai-suzhou-hangzhou-itinerary`（174 曝光 / 0 点击）加一条指向上海团页的内链 | GSC 页级 28 天 | 非保护页；**74 号 10-21 决定：只做 dry_run 预览，不写网站**（按 §5 流程约定 3） | 预览由 95 出；真要上线再走博客 PR 通道 | 预览给 PM；上线另批 |
| R4 | **总览页和上海团页的标题 / 描述这轮不改** | 总览页已知词级数据只有品牌 / 产品名且已排前 5；上海团页自然曝光极少，目标词量 + 难度不齐 → 闸门不过（`keyword_data_unavailable`）；小流量页点击率测不出效果（playbook §十四）。这是「闸门不过 + 样本不足」，不是「判定没价值」 | 闸门不过 → 写原因，不降级 | — | 否 |
| R5 | 上海团页登记 1–2 个词进周快照追踪词 | — | — | **暂缓**：74 号 10-21 决定先不做，等 PM 批（74 下次汇报时问）。批后由有权限的会话单行写入 `seo_config`，带回执与回滚（SEO Agent 本身**不写** `seo_config`；做法同 PR 2555） | 是（等批） |

另（范围外机会，按 playbook §十 主动报，不擅自扩范围）：`things to do in shanghai` NZ 月搜 **480**、难度 0，现只排 39，量是上海团页头词的 16 倍；但属指南意图，不属广告请求范围，列给 74 决定。

## 5. 红线

**机器强制（合同字段 / 代码闸）**：①信息完整闸门不绕：缺量 / 缺难度 / 没取 SERP / 排名的是另一页 / 同词 90 天内被别页用过 / 与原文事实矛盾，任一项缺 = `blocked`，不降级、不借别页的词；②`needs_pm_approval` 由规则算（§2 表），不由 Agent 自报；③`no_publish: true` 永远；④保护页走 A1 `PageWriteGuard`，名单与台账用全路径。

**流程约定（靠评审与回执核对，不是机器保证）**：
1. 有流量页面不做大改：命中受保护名单或高流量阈值（§2，CTS 初值 28 天曝光 ≥ 300，配置项）→ 只出建议、强制 PM。
2. 价格 / 日期 / 班期以官网实读 / 团数据为准，SEO 不带第二份。
3. **客户官网文案改动先 `dry_run` 给 PM 看**（74 / PM 10-21 红线）：本 Agent 首批所有文案类建议（标题、描述、内链锚文本）都先预览给 PM，验收看最终改出来的文字，不看回执是否全绿（W38 教训）；跑稳后再回到 10-14 手册 §3 的事后汇报。
4. 说「有效」之前先过三关：真执行过吗（有执行方回执）？单页 / 单词比，不拿整站涨跌（小流量以目标词排名为尺子）？经验库的 SEO 经验不当依据。
5. 发布 / 开投 / 加预算只认 PM 本人。

## 6. 最小可验证 MVP

- **v0（本稿，本周）**：设计 + 词归属台账初版 + 第一份建议（§4）。
- **v1**：先拆出**与候选解耦的闸门入口**；再做一个 Inngest 函数处理 `page_intent_check` / `cannibalization_check` 两种请求（只用现成取数 + 闸门），写回执。**用 dry_run 或测试请求真实跑通一次 request → 回执**（不真发任何东西）才算做好；单元测试绿不算。
- **v2**：`ownership_check` 给 121 调用；站点地图 / canonical / noindex 体检；`page_text_suggestion` 走 dry_run。
- **对账时点**：页面上线后 72h / 7d 走现有发布后复查；**名次对账最早在第 18 天以后**，v1 跑通时同时开台账卡，`verify_by` 设在那天（以及日历提醒）。
- **验收口径（74 号 10-21）**：W1 只验「广告 → creative 请求」那一条端到端；SEO 这条先算设计稿，**不排验收**。
- 要别的窗口给：98 / 73（定位对表，由 95 约）；119（合同字段 / 事件名，唯一权威）；121（接管清单、团数据 slug、`ownership_check` 回执）；122（`agent_request_receipts` 接新事件）。

## 7. 取数花费
GSC 为只读库内数据，未花钱；DataForSEO 一次 `keyword_overview`（12 个词，NZ）——封装未回报单价，量级几美分，未实测；走每月 US$15 付费数据预算口径。

## 8. 待对表（98 / 73 本人点头，18 号统筹文档层面已核：未发现冲突，但不能替他们说「无异议」）
18 号对过 73 的 10-14 工作流与决策权表 §3/§4、目标—计划—每日循环 v0.1 §6.3、A1 保护页闸、周名次 / 计划器：「排期与验收归 98、规则与手册归 73、执行窗口一件一窗」与本稿 §0 分工一致；计划器（周一计划器 + 每日派发器）本来就是唯一自动派活者，本稿让 `seo_request` 变成计划器里带证据的计划项，与「派活不带核验」硬禁令、页面互斥闸不矛盾。下面三点是本稿**新增的归属或变更，必须 98 / 73 本人点头**：
1. **新增归属**：「广告请求入口 + 回执归 95」是新的；98 的排期 / 验收权要写明怎么和它衔接。
2. **规矩口径**：74 / PM 10-21 给本入口的更严红线（官网文案改动先 `dry_run` 给 PM 看、有流量页不做大改）与 73 决策权表「非保护页标题描述自动、官网 B 级改动写入者出稿 + 审查后合并」在新入口上不一致；需 73 记一句「**新入口先按更严的跑，跑稳后再回 10-14 口径**」，免得两份规矩打架。
3. **互相让路**：121 的「接管页唯一写入者 / `site_agent_owned_slugs`」与计划器页面互斥闸、执行窗口怎么互相让路，要 98 / 73 对一次。
处理：本稿按「草案，待 98 / 73 对表」合并；对表结果回写本文件的状态行。**设计稿合并 ≠ 批准实施**：新增 `seo_request` 处理函数、请求表、对外入口都属大任务，动手前须子牙 + 魏征双审（设计阶段一次、实施后一次）。

## 9. 给 121 的对接件（10-21）
**tour_slug 对照**：对 `config/clients/cts/offerings.yaml`（`code` ↔ `itinerary_url`）逐行核对，`code` 与官网路径末段**不总是一致**，所以**对接键用官网路径 `/tours/china/{层级}/{slug}`（offerings 已有 `itinerary_url`），`code` 只当别名**：

| offerings `code` | 官网路径末段（121 的 tours.ts slug） | 一致？ |
|---|---|---|
| `golden-china` | `discovery/golden-china` | 是 |
| `best-of-china` | `discovery/essentials` | **否**（code ≠ slug） |
| `tale-of-two-cities` | `discovery/beijing-xian` | **否** |
| `silk-road-discovery` | `signature/silk-road` | **否** |
| `shanghai-surroundings` | `discovery/shanghai-surroundings` | 是 |
| `xmas-nye-akl` / `xmas-nye-chch` | 已下架，旧页 301 到 `/tours/china/discovery` | — |
| （offerings 没有）`yunnan-explorer`、`signature/{imperial-heritage,grand-tour,landscapes}`、`stopover/*` | 官网有、offerings 无 | offerings 不全，以官网路径为准 |

**ownership_check 的只读出口（方案，待 119 定稿）**：不让官网仓库读 ME 库。①**长期**：`ownership_check` 走合同里的 `seo_request` / `seo_receipt`（`kind=cannibalization_check`），121 的页面变更回执里的 `ownership_check` 值来自 SEO 回执，不需要官网仓库读任何清单；②**过渡**（出口就绪前）：121 回执里该字段写 `unavailable`（不写 `pass`）；需要时 121 把"要改的页 + 目标词"发给 95，95 对着下表人工回 `conflict / clear / no_data`，写入页面变更说明。

**词归属 v0（候选，只含量 + 难度齐、且未核 SERP 归属的词；待 121 / 119 对表后才算数）**
| 词（NZ 月搜 / 难度，2026-10-20 单次取数） | 候选正主页 | 说明 |
|---|---|---|
| `things to do in shanghai`（480 / 0） | `/shanghai-travel-guide` | 指南页，121 不接管 |
| `china tours`（260 / 6） | `/china-tours` | 在保护名单（PM 批才可改） |
| `china tours from new zealand`（210 / 0） | `/china-tours-from-new-zealand` | **该页既在保护名单（`meta_cycle_protected_slugs`），又在 121 的接管提议里**——改文案需 PM 批，121 改它前先确认 |
| `shanghai tour(s)`（30 / 取不到） | `/shanghai-tours` | 121 的接管清单没列这页，归属待 121 / 98 定 |
其余团名类词（量取不到）按规则写 `keyword_data_unavailable`，不登记。
