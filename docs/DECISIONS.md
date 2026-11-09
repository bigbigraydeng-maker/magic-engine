# Magic Engine — 架构与业务决策记录

> 倒序。每条格式：**日期 · 决策 · 为什么 · 影响什么**。
> 只记「改变了后续做法」的决策；日常任务进度见 [ROADMAP.md](./ROADMAP.md)，已上线功能见 [history/CHANGELOG.md](./history/CHANGELOG.md)。
>
> 来源：原 `ROADMAP.md § 8 决策日志` + `CLAUDE.md` 内嵌 PM 拍板段 + git 提交记录。

---

## 2026-09-25 · 写代码默认交给 DeepSeek，Claude Code 出指令和审

**决策**（PM 2026-09-25）：所有开发窗口写代码默认由 DeepSeek 执行（Claude Code 用 aider 直接驱动），Claude Code 负责出指令、审 diff、验证、提 PR、查库。例外两类：要同时看懂多个文件的核心改动、A 级安全核心。替代 2026-09-23「只管新窗口的试行」。

**为什么**：试行两批实测都一次写对且便宜——广告 WP0 8 轮 $0.037、B2 三只闹钟 11 轮 $0.11；贵的模型只花在判断和审查上。

**影响什么**：`CLAUDE.md` §5 改写；每个 PR 写明 DeepSeek 轮数与花费，例外部分写原因。

## 2026-09-21 · Campaign 作为所有增长类营销活动的唯一组织单元

**决策**：ME 所有面向增长的营销执行，统一以 **Campaign** 为组织单元，不再允许"散单内容"并行运转。原 `content_posts` 直写路线、`social_plans` 独立写入路线，全部归并到 Campaign 之下。

**PM 拍板（2026-09-21）**：

1. **Campaign 是增长执行的入口**：Campaign 对应一个有明确目的的销售/推广周期（例如：Signature Escape 十月推广、圣诞团预售、品牌暖场），而不是"今天发一条"这种松散模式。Campaign 下可包含：社媒内容（FB/IG Post、Reel、Story）、广告计划、Newsletter。

2. **Campaign 创建走对话，不走表单**：用户（客户或 FDE）用自然语言多轮对话完成 Campaign 设置——说清楚"推什么、给谁看、在哪段时间、目标是什么"，系统自动建 Campaign、拉 Master Brief、生成内容框架。传统表单 / 多级菜单 UI 退为应急兜底，不是主路径。

3. **内容工厂保留，但定位收窄为"下载用内容"**：小红书推文、用于人工转发的素材、非发布用的生成内容继续走内容工厂；不与 Campaign 发布管道混用。

4. **`content_posts` 降级为 Campaign 写入的存储层**：用户不直接接触 `content_posts` 这个概念；Campaign Bundle 批准后写入 `content_posts` 再流向发布，是内部实现细节。

**为什么**：

- ME 的核心命题是增长智能（Digital Marketing Growth Intelligence）。增长不是"每天发内容"，而是"围绕一个目标，设计一段时间窗口里的动作序列"——这就是 Campaign 的语义。散单内容无法追踪 Outcome，Campaign 有完整的 Check/Tune 闭环。
- 当前后台存在 `content_posts`（直写）、`social_plans`（Campaign Daily Plan）、视频工厂等多套并行路径，FDE 和客户不知道从哪里进、从哪里发，发出去的内容也无法归因到某个增长目标。
- 对话式创建是 ME 区别于传统营销 SaaS 的核心差异点：客户不需要学软件，只需要说清楚"我想做什么"。

**影响**：

- 新客户（含 NM Medspa）的社媒内容，后续统一先建 Campaign，再从 Campaign 出内容，不再直写 `content_posts`。
- 现有无 Campaign 归属的 `content_posts` 记录（历史散单内容），在 UI 上标"散单 / 待归入"，不迁移但也不继续新增。
- Campaign 创建界面：v1 实现多轮对话补全（`campaign_id`、时间窗、目标受众、核心诉求、关联 Master Brief），表单填写降为备用。
- Newsletter 纳入 Campaign 作为一路输出，与社媒内容共享 Campaign 目的和受众定义，单独管理发送时间和内容格式。
- 发布管道：Campaign Bundle 批准 → 写 `content_posts`（`status=approved`）→ 发布 → 回写 `content_posts.publer_post_id` / `published_at`。（Publer 已于 2026-10 删除）

---

## 2026-09-21 · 数组列一律存空数组不存 NULL；订正 `clients.brand_aliases`「schema 漂移」误判

**决策（技术决策，两条）**：
1. **接口清空别名时写 `[]`，不再写 NULL。** `clients.brand_aliases` 自 `20260625000001_a21_goal_current_value.sql`
   起就是 `NOT NULL DEFAULT '{}'`（该 migration 已回填存量 NULL 并 `SET DEFAULT` / `SET NOT NULL`），仓库和线上
   本就一致，**没有漂移，不需要新增对齐 migration**——最初排查时只看了引入该列的 `20260624010000`，漏看了同一列
   后续还被 `20260625000001` 加固过，误判成「线上手工改动、仓库未记录」。
2. **往后数组列一律存 `[]`，除非确有读取方靠 NULL 和 `[]` 区分行为。** NULL 在这里没有任何含义，
   只多出一个能把写操作打挂的状态。这条判断本身不受上面订正影响。

**为什么**：真正的 bug 只在接口代码——`clients.brand_aliases` 早就是 NOT NULL，但 PATCH 清空时仍写 NULL，
数据库拒绝（23502），接口 500，品牌别名设置面板能加不能清空。2026-09-21 在本机 Postgres 沙盘复现确认。
现有全部读取方（`isBrandedKeywordWithAliases`、`auto-fetch`、`rankings`、`crm/touchpoints`、`serp-capture`）
本来就把 NULL 和 `[]` 当同一件事，所以存 `[]` 是零行为变化的那一侧。

**影响**：[PITFALLS B5](./PITFALLS.md) 记录的教训改为「判断 schema 漂移前必须 grep 该列全部历史 migration，
不能只看引入它的那一条」，而不是「线上被手工改过仓库不知道」。兄弟接口 `primary-keywords` / `competitor-domains` /
`products` / `excluded-topics` 仍在写 `? null :`，2026-09-21 实测这四列线上确实是可空所以没炸，已记入 B5 待清理，
本次不动以保持改动范围最小。

## 2026-09-20 · SEO 标题周循环 v1：新自动化一律上 Inngest、按真实用量定规模、自动改文案必过信息完整闸门

**决策（PM 2026-09-20 拍板，三条）**：
1. **往后所有新的跨步骤自动化流程，一律跑在 Inngest 上，每一步留机器可读回执。** 旧的 `cts-seo-optimizer`（Render 定时盲改标题）已退役，换成 Inngest 两段式 `cloud-seo-meta-cycle-fanout` + `cloud-seo-meta-cycle-run-one`，六步各写一条 `cron_run_logs`。
2. **按真实用量定设计规模。** 实际用量是一个客户每周 ≤3 个页面，所以自动撤回、来回改封顶、学习记忆写入、跨客户预算熔断这套机器全部砍掉——复审两轮找到的 bug 全出在自动撤回这块。改坏了（14 天回查判定变差）只下发一条人工看板待办，指向那条已合并 PR 自带的 GitHub Revert 按钮，不写任何新的撤回代码。
3. **SEO 文案只在信息完整时才改。** 必须同时有 DataForSEO 搜索量 + 难度、实时搜索结果前 3、且关键词确实属于这个页面（这个页面自己的 GSC 搜索词），才许改；缺任何一样 = 跳过并记原因，**绝不默认填值**。给客户打开开关前，先跑一次演练（`dry_run`）给 PM 看。

**为什么**：第一次真跑（W38）自动合并了 2 条错误改动（见 [PITFALLS D10](./PITFALLS.md)），六步回执全绿却改错了字——缺数据时默认填 0、关键词跨页借用，是直接原因。

**影响**：信息完整闸门见 `src/lib/seo-meta/cycle/gate.ts`（PR #1816）；CTS 开关 `clients.seo_config.meta_cycle_enabled` 目前关闭，等 PM 看过下一次演练再开。设计文档 [`docs/specs/2026-09-20-seo-meta-cycle-v1-spec.md`](./specs/2026-09-20-seo-meta-cycle-v1-spec.md)，跟进清单见 Issue [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807)。

## 2026-09-13 · 客户知识库作为 Governed Lead-Reply Agent 的事实层，替代 offerings.yaml 路线

**决策**：AI 对终端客人说出口的业务事实（价格、时效、承诺、退改政策、在售/停售产品等），统一存放在**逐条治理的客户知识表**里，而不是按客户放 `config/clients/<client>/offerings.yaml` 文件。该知识表是已登记 L1 候选「Governed Lead-Reply Agent」（`docs/registry/platform-candidates.md`）的**事实层子能力**，不另立 L1。原方案"3 个客户后再抽 `client_offerings` 表"作废。

**PM 拍板（2026-09-13）**：
1. **双签**：ME/FDE 先批草稿；价格/时效/承诺/政策类条目必须**客户本人确认**后才对终端客人生效。确认人由全局管理员单独登记，经发到客户邮箱的一次性链接、点按钮提交确认；确认人不得是任何 ME 身份，不得是登记人或批草稿的人。
2. **先做功能，套餐准入延后**：原"仅 NZ$499 档以上或 FDE 托管客户开放"暂不实现（五档会员在代码里尚不存在，`clients.plan_tier` 仍是老三档 starter/growth/enterprise）；v1 只做单客户开通开关（默认关）。
3. **必须和客户一起测试上线**：内部整理 → 客户共测（AI 出草稿不发送，双方抽查）→ 上线。首个试点客户 = New Asian Logistics。

**为什么**：
- 文件 + PR 路线做不到逐条客户确认、有效期、证据溯源；改一次价格要合一次代码。
- ME 已有 6 套互不相通的"AI 脑子"（`master_briefs`、`voice_knowledge_documents`、`voice_tenants.settings.brain`、`src/lib/messenger/brief.ts` 提示词、规划中的 offerings.yaml、ME 之外的 ElevenLabs 提示词），其中 `brief.ts` 把 CTS 的事实写死在所有客户共用的代码里，且 `brief-cycle.ts` 调用时不传 clientId——非 CTS 客户拿到的也是 CTS 提示词。
- NAL 真实私信证明对话不能直接当训练材料：同一价格有 4/2、7/5、6/4 多个版本，一个快捷回复模板把"20 公斤以下"写成"10 公斤以下"已发给 28 位顾客。

**影响**：
- Governed Lead-Reply Agent 方案的 Layer 1 改读知识库读取入口；数字核实闸核对"已批 + 客户已确认 + 有效期内"的值；自动确认回复不得读知识库事实。随该方案 2026-09-15 三审同步修改。
- 对话知识萃取永不自动上线；敏感度用确定性规则判定（出现任意数字即非 general），不依赖 AI 标签。
- 回复草稿在显示和发送前各做一次输出检查，草稿里的数字对不上生效条目即撤回转人工。
- 上线发送走 Governed Reply 的"草稿 → 人工点发"链路，不经执行内核（内核 v1 拒绝撤不回的对外动作）。
- 设计与两轮复审记录：本机 plan `client-knowledge-base-capability.md` §9–§9.14。实施按 A 级分 6 个 PR，每个实施后复审。

## 2026-09-09 · ME ↔ Creatomate 视频生产职责边界冻结

**决策**：PM 拍板，Magic Engine 视频生产系统里 ME 与 Creatomate 的分工边界正式冻结为后续架构依据（PM 原话，逐字保留）：

1. Magic Engine 负责导演和决策，包括目标理解、叙事结构、脚本、镜头表、素材选择、节奏、字幕、音乐情绪、CTA 和审片。
2. Creatomate 负责执行已经制作好的模板，只能填充模板中已声明的槽位，不能动态创建新的镜头结构、页面或时间线。
3. 每一种新的视频形态，都必须先在 Creatomate 可视化工具中制作新模板。
4. ME 需要维护模板注册表，记录模板版本、可用槽位、字段类型、约束、画幅、时长和预览信息。
5. Creatomate 不提供低成本分镜预览，也不支持局部重渲染；修改一个镜头通常需要重新渲染整片。
6. 模板槽位映射是持续维护的隐性工作，模板变化时必须同步更新。
7. 外部通知不能作为唯一状态依据，ME 必须通过任务状态查询、轮询和补偿机制确认渲染结果。

**为什么**：第 2/3 条纠正了一个容易高估系统灵活性的误区——结构化数据只能"填槽"，不能"造槽"；新增镜头数量/顺序/风格仍然需要人在 Creatomate 编辑器里画新模板，这条边界呼应了更早「旅游 vlog 剪辑买不做」的拍板，没有因为接了 Creatomate 就等于 ME 有了任意编排视频的自由度。第 5/6/7 条是本次接入 Creatomate（PR #1513）过程中两轮复审揪出的真实运维约束（付费步骤不可重放、webhook 无签名机制不可信、模板槽位表需要人工维护且没有自动同步手段），不是设计偏好，是 Creatomate 官方 API 的真实能力边界。

**来源**：[PR #1520](https://github.com/bigbigraydeng-maker/magic-engine/pull/1520)（[`docs/specs/2026-09-09-me-creatomate-responsibility-boundary.md`](./specs/2026-09-09-me-creatomate-responsibility-boundary.md) 完整分析，含每条结论的验证依据标注）。

**影响**：后续任何"能不能让 Creatomate 做 X"的讨论，先查这条决策和源文档的验证依据，不用重新论证一遍；新增视频形态（新镜头数/新结构）默认走"先人工画模板"路径，不应假设可以纯代码实现。`src/lib/creatomate/` 的模板契约（`factory_config.render.creatomate`）是第 4 条"模板注册表"的雏形，尚未做到版本化/约束校验/预览，后续加强时对齐这条决策的字段清单。

## 2026-08-22 · 产品定位与 IMPACT v1.0 冻结：Digital Marketing Growth Intelligence System

**决策**：Magic Engine 的正式产品类别冻结为 **Digital Marketing Growth Intelligence System（数字营销增长智能系统）**。唯一端到端产品闭环冻结为 **IMPACT = Inspect → Measure → Prescribe → Act → Check → Tune**。DAPE 保留为内部工作方法，主要服务 IMPACT 前四段，不能与 IMPACT 互换，也不能用执行完成代替 Check、Outcome 与 Tune。

**产品边界**：ME 自建 Digital Marketing Growth State、Opportunity Intelligence、Next Best Digital Marketing Action、营销策略与资产 Intelligence、Measurement/Attribution、Outcome/Failure Intelligence、Learning Promotion 与 Governed Execution。CRM、预约、POS、库存、支付、旅游预订、移民/留学案件、通用 OAuth/Workflow/Observability 等成熟经营或基础设施能力默认通过 API、Webhook、MCP 或成熟外部产品连接，不重复建设系统本体。

**权威来源**：[`docs/strategy/ME_PRODUCT_DEFINITION.md`](./strategy/ME_PRODUCT_DEFINITION.md)。该文件是产品定位、IMPACT、DAPE、Connector、Build vs Connect 和行业版本边界的最高优先级定义。代码、测试、Issue、PR 和部署只证明实现状态，不能反向改写产品定义；当前运行事实仍以 `STATE.md`、生产证据和最新 Build Control 为准。

**影响**：`CLAUDE.md` 将本文件设为所有 Agent 必读入口。后续 Roadmap、WP、行业方案和客户交付必须说明所属 IMPACT 阶段、Build vs Connect 判断、Connector 边界、验证方法与 Outcome。旧文档若与本决定冲突，以产品权威文件为准，并分阶段修正，不一次性扩大 runtime 或迁移范围。

## 2026-08-19 · ai-tracker（系统 B）退役删除：AI 可见度判断归一到 M1，老诊断打分重做

> **本条推翻同日早前版本**（原标题「三系统整合：判断层统一到 M1，ai-tracker 降级为采集层」，原结论是「降级保留 ai-tracker 采集层 + 五阶段小心迁移」）。PO **2026-08-19 追加授权做减法**（删老功能）：ai-tracker 不是降级保留，是**退役删除**。原判决的证据段（44% 抽取失败、子串匹配、`ai_visibility_score` 实读系统 C）全部成立、予以保留，只把结论从「保留采集层」改成「删」。

**决策**：仓库里三套 AI 可见度系统（A=`geo-baseline`+`geo-module` M1 / B=`ai-tracker` / C=`industry-ai-visibility`），PO 拍板：

1. **M1 是客户 AI 可见度唯一真相源**，神圣不可碰，只能往它靠。
2. **ai-tracker（系统 B）整套退役删除**：`src/lib/ai-tracker/` + `src/app/api/ai-tracker/*` + `src/app/dashboard/ai-visibility/*` + `ai-tracker-weekly` cron（`render.yaml`）+ 三张表 `ai_visibility_queries` / `ai_visibility_runs` / `ai_visibility_snapshots`。**为什么现在能删而不是降级保留**：ME 尚未对外推广、无付费存量在被动消费这条线，不需要为存量而保留一套判断质量已知不达标的系统；两套并行只会持续制造「同名字段不同数据源」的混淆（见影响面）。**采集层不再保留**——原版「保留 question-generator + 采集节奏接上 M1」的方案随本次授权作废；但「按客户生成/沉淀跟踪问题」是 M1 目前缺的净能力，须显式列入 M1 待补（见拆除清单 §7 异议 2），别让它随代码蒸发。
3. **老诊断打分（`src/lib/diagnostic`）的 AI 可见度维度：重做，取自 M1**（ROADMAP P31.X.4）。这条是客户可见分数、且是活的，属**改写搬迁**不是删——三张表 DROP 必须等它接到 M1 之后（拆除清单执行顺序已把 DROP 卡在最后）。
4. **`industry-ai-visibility`（系统 C）不删、不合并**，但**切断它冒充客户级分数**：Goals 的 `ai_visibility_score` 现在错读系统 C 的行业均值（`auto-fetch.ts:65-66`），当成单客户分数写进 Goals。这条独立于 ai-tracker 删除（不同表、不同系统），走独立小 PR 先落。系统 C 的合法消费方是 **Industry Baselines 看板/API**（不是 Yellowbook——Yellowbook 只在 `industry-ai-visibility/types.ts:6` 注释里，尚无代码），保留。

**完整拆除清单**（逐个缠线定性 DELETE / REWIRE→M1 / LEAVE-SEVER、删除执行顺序、DROP 表清单、我方异议）见 [`docs/specs/2026-08-19-ai-tracker-decommission-v1.md`](./specs/2026-08-19-ai-tracker-decommission-v1.md)。**本轮零删除、零 DROP、零 cron 改动**——真正的删除是复审干净 + PO 最后 `go` 之后的独立 PR。

**为什么删而不是修**：`ai-tracker/parser.ts` 的品牌命中逻辑是**子串模糊匹配**（`brand.toLowerCase().includes(clientLower)`，且允许反向 includes，代码见 `parser.ts:119-125`），M1 明令禁止这种做法（M1 用 `buildEntityMatcher` 精确别名匹配 + 否定探测 + owned-citation 剔除）。**真实故障记录**（`docs/archive/DIAGNOSTIC_FINDINGS.md`）是 parser 成功率仅 **44%（11/25）**——多数情况下是直接抽不出品牌结果，而不是抽错；子串匹配本身**目前没有已发生的具体撞车事故记录**，是一个**理论假阳风险**（例如「CTS」与母公司「China Travel Service」这类子串包含关系，一旦答案里同时出现两个名字就可能误判），风险成立但不是「已实测命中」。品牌抽取本身是结构化 LLM 抽取（先让模型输出 `brands` 列表），子串匹配只发生在最后从这份列表里定位「哪一条是客户自己」这一步（`parser.ts:119-125`）——判断链条整体缺 disposition 分级、缺 defer/indeterminate、缺 lineage/审计字段。M1 有五档推荐分级（仅 `explicit_positive` 进指标）、`defer`/`indeterminate` 优先于编造的正结论、`reasonCodes` 全审计。既然判断层已判死、且无存量要保护，采集层单独留着没有意义——故整套删。

**证据（代码对比）**：

```ts
// ai-tracker/parser.ts:119-125 —— 子串模糊匹配，双向 includes（真实故障：44% 抽取成功率）
const clientMention = brands.find(b => {
  const bLower = b.brand.toLowerCase()
  return (
    b.brand.toLowerCase().includes(clientLower) ||
    (clientLower.length >= 3 && bLower.length >= 3 && clientLower.includes(bLower))
  )
})
```

```ts
// geo-module/m1.ts —— 精确别名注册表 + 否定探测 + defer 优先
function buildEntityMatcher(aliases: readonly string[]): RegExp { /* 精确别名，非子串 */ }
// disposition: 'defer' 永远优先于一个可能编出来的正结论（见文件头注释）
// owned citation ≠ mention（M1 §7，Codex #1032 第 5 轮 P1 生产实证）
```

**影响面**：
- Cron：`ai-tracker-weekly`（`render.yaml:204`，每周一 01:00 UTC）**是删除对象**（拆除清单步骤 2，本轮不动）；`industry-ai-visibility-daily`（每天 02:30 UTC，⚠️ route 命名历史遗留为 `/api/cron/ai-visibility-weekly`，实际调 industry 逻辑）**不动**（系统 C）；`goal-current-value-refresh` 依赖链见下条订正。
- **订正：`ai_visibility_score` 真实数据源是系统 C，不是系统 B**。`src/lib/strategy/auto-fetch.ts:442-524` 与 `goal-current-value-refresh` cron 证实，Goals 的 `ai_visibility_score` 读的是 `industry_ai_visibility_snapshots`（`auto-fetch.ts:496,522`），跟 ai-tracker 的 `ai_visibility_snapshots`/`ai_visibility_runs` 是两张不同表、不同系统。同名字段（`ai_visibility_score`）容易误判为同一数据源，实际链路互不相关。原判决与原 issue 的 Phase 3 都基于「Goals 读系统 B」这个错误前提，需要重新定义。
- 依赖 `ai_visibility_score`（系统 C 口径）的代码：`src/app/api/cron/goal-current-value-refresh/route.ts`、`src/lib/strategy/baseline-audit.ts`、`src/lib/strategy/auto-fetch.ts`、`src/lib/flywheel/anomaly/rules.ts`、`src/lib/factory/copy-generator.ts`、`src/types/strategy.ts`。
- **补充：ai-tracker（系统 B）真实消费方清单**（原判决遗漏，全仓核实后补齐）：
  - `src/app/dashboard/ai-visibility/[clientId]/_components/RankingsTable.tsx:18-22` —— 前端独立实现了一份 `isClientBrand`（`a.includes(b) || b.includes(a)` 双向子串匹配），跟 parser.ts 是同一漏洞模式，直接消费 `ranking_table.brands`，判断逻辑跑在浏览器端，前端组件清单同时含 ModelStats / QueriesManager / EngineComparison。
  - `src/lib/blog/topic-selector.ts`（读 `ai_visibility_runs.client_brand_rank` 决定博客选题）
  - `src/lib/blog/page-seo-intelligence.ts`（读 `ai_visibility_snapshots` + `ai_visibility_runs.client_brand_rank` 找 GEO 内容缺口）
  - `src/lib/monthly-report/collectors/ai-tracker.ts` + `src/lib/reports/monthly-aggregator.ts`（**客户月报数据源，C 端可见交付物**，读 `ai_visibility_runs`/`ai_visibility_snapshots`/`ai_visibility_queries`）
  - `src/lib/diagnostic/collectors/ai-visibility-collector.ts`（诊断发现流，读 `ai_visibility_snapshots`）
  - **拆除清单进一步发现**（原判决与早前版本均遗漏）：`src/lib/ai-tracker/` **不能整目录删**——`parser.ts`（`parseRanking`）被系统 C 的 `industry-ai-visibility/collector.ts:17`（要保留）与诊断 probe 复用，`runners/openai.ts`（`runOpenAI`）被 `prospecting/analyze.ts` 与诊断 probe 复用。必须先把这 4 个共享文件平移到中立目录再删，否则打断系统 C。另有 flywheel（`GeoComposerAdapter.ts:84`）、`geo/composer.ts:139`、`strategy/analyzer.ts:37/68`、主看板 `dashboard/page.tsx:166`、demo 种子、admin 维护路由、8 个死调试路由等缠线，逐条定性见拆除清单。
- 表：`ai_visibility_queries` / `ai_visibility_runs` / `ai_visibility_snapshots`（ai-tracker，系统 B，**DROP 对象**）vs `geo_query_sets` / `geo_queries` / `geo_batches` / `geo_observations` / `geo_evidence`（geo-baseline，系统 A，冻结契约见 #883/#917 WP04A，**不动**）vs `industry_ai_visibility_snapshots`（industry，系统 C，Goals 实际读这张，**不删但断开冒充**）。

**注意与 2026-05-17 决策的关系**：当时「AI Tracker 保留自建，不切 Apify」是判**采集端** vendor 选型。本条退役 ai-tracker 后该决策的对象不复存在（不再有 ai-tracker 采集端要选 vendor）；客户级采集能力今后由 M1 承担，行业级由系统 C（DataForSEO）承担，那条旧决策就此作废。

**后续步骤**：拆除执行顺序（先断消费方 → 平移共享件 → 删代码 → 最后 DROP 表，DROP 不可逆需 PO `go apply`）见拆除清单 §6 与 tracking issue #1073。原「五阶段小心迁移」计划随本次授权作废。**子牙（架构）+ 魏征（挑刺）已复审拆除清单，判「可作真删 PR 依据」，修正意见已并入清单 §4/§8/§9**（含护城河靶心：flywheel `geo.query.mention_rate` 断供 → 诸葛亮归因失效，见清单 §9.1）。**A 级任务**，禁止一次性授权，**每一步单独要 PO `go`**。

## 2026-08-19 · Magic Engine 默认 Reuse First，未来垂直版本共享同一底层平台

**决策**：Magic Engine 的长期形态是**一个共享平台 + 多个垂直版本**。真实客户与 Customer Zero 用来发现、验证、加固可复用能力，不默认发展成客户特供系统。未来在行业理解、数据与客户样本足够后，可以推出 **ME Real Estate / ME Travel** 等垂直版本，但底层默认共享 Capability、Adapter / Connector、Kernel / Governance、Measurement Contract、Growth Contract、Verification / Attribution / Flywheel，以及经证据证明可泛化的 Learning / Memory 机制。完整冻结原则见 [ME2 Reuse & Platformization Principle](./roadmap/2026-08-19-me2-platformization-principle.md)。

行业差异进入 **Industry Playbook / Profile / Policy**；客户差异进入 client configuration、approved evidence 与 client-private memory。Memory 明确分三层：client-private、industry、global platform；客户私有事实与学习绝不跨租户泄露，行业/global 学习必须有跨样本证据后才能升级。

**为什么**：Roman GEO 已经暴露一个典型失败模式：接口和 `clientId` 看似通用，但实体名、Auckland/NZ、real-estate/Ray White 等语义仍硬编码在 shared-looking module 内。若不把“可复用机制”和“首个客户语义”分开，后续 CTS、ME 官网和新行业会不断复制/分叉，平台会越做越复杂。

**影响**：所有开发窗口统一执行 `Repository Fact Gate → Domain Semantics Gate → Product Gate → Architecture / Reuse Gate → GO BUILD`。Current State Audit 第一行必须报告 `remote fetched at + exact main SHA`；没有 SHA，审计不成立。每个有实质产出的交付必须附 **Reuse Statement**，说明复用了什么、哪些是 platform-shared / industry-specific / client-specific，以及是否存在客户/行业语义进入 shared runtime。新增共享能力前先证明现有 Capability / Adapter / Contract 不能承载；客户名、客户 ID、行业规则默认不得进入 shared runtime。

## 2026-08-14 · 工程质量按风险分级，不一刀切

**决策**：所有 Issue / PR 开工前声明 A / B / C 风险级别，测试、集成、mutation 和 review 强度按真实失败后果匹配。统一原则：**高风险地基慢而稳，普通业务正常推进，UI 和原型继续快。** 完整规则见 [ENGINEERING_QUALITY_GATES.md](./ENGINEERING_QUALITY_GATES.md)。

**为什么**：早期开发速度快但高风险边界缺少证明；近期安全与 Kernel 工作显著提高了质量，也暴露了范围扩张、反复完整 mutation 和无限 review 轮次带来的交付停滞。质量不足和质量过量都会伤害 Magic Engine 2.0。

**影响**：A 级保留威胁/并发模型、真实边界集成、关键 mutation 和集中复审；B 级默认核心测试 + 少量集成 + 一次 review；C 级以 smoke/截图/build 为主。只实现当前调用方的最小契约；review 收敛与停止条件继续执行 GitHub #964。
## 2026-07-25 · 素材来源政策：不足就去全网抓

**决策**：素材不足不是借口。抓取优先级按**合规性**排（不是按方便程度）：① Unsplash / Pexels（免费商用，零风险，首选）② Apify 各类 scraper（Pinterest / IG / FB，用于找参考定风格）③ 客户自己上传的真实素材（质量最高、唯一能打真价）。加工链路：好看的图 →(i2v)→ 视频，或 图 →(图转图换风格)→ 再转视频。

**为什么**：PM 拍板「版权的事情不需要你考虑」，风险由 PM 承担，agent 不再反复请示。

**影响**：仍保留一条**客户利益**红线（非版权洁癖）——客户**真实产品 / 真实价格**的画面只能用客户自己提供的素材；抓来的图可做氛围，不能冒充客户产品。

## 2026-07-25 · 文档体系重构

**决策**：根目录只留 `CLAUDE.md` / `README.md` / `AGENTS.md`；其余全部进 `docs/`。新增 `STATE.md`（唯一真相源）/ `ENV.md` / `DECISIONS.md` / `PITFALLS.md`；`ROADMAP.md` 只留未完成；完成日志拆到 `history/CHANGELOG.md`。

**为什么**：审计发现 194 个 .md 里，`ARCHITECTURE.md` 停在 2026-05-23（列 45 个端点但实际 403 个、15 张表但实际 141 张）、`TESTING.md`/`QUICK_REFERENCE.md`/`PROJECT.md` 是前身项目 CrazyContent 的遗留、62 个在用环境变量无任何登记、7 个 cron 端点没有调度器。

**影响**：删 `TESTING.md` `QUICK_REFERENCE.md` `PROJECT.md` `DEPLOYMENT_RENDER.md`；`AUTOMATION_SPEC.md` `BILLING_TOKEN_SYSTEM.md` `PLATFORM_ARCHITECTURE.md` `MODULE_MAP.md` 归档；`docs/superpowers/specs/` 并入 `docs/specs/`；根 `clients/` 并入 `docs/clients/`。全量 ROADMAP 底稿保留在 `docs/archive/ROADMAP-full-2026-07-25.md`。

## 2026-07-21 · 高频 sweeper 降频

**决策**：`vision-analyzer` / `poll-visual-jobs` 从 `*/2` 降到 `*/10`；`zhangqian-sweeper` / `blog-stuck-generating-sweeper` 从 `*/5` 降到 `*/15`。

**为什么**：每日调用量下降 77%，成本与 Render cron 配额压力。

**影响**：commit `b9f8189`。`render.yaml` 内仍有一处注释写着 "every 2 minutes"（已修正）；任何引用旧频率的文档都是过时的。

## 2026-07-20 · 跟 PM 说话的格式

**决策**：一次只问一件事 · 问题必须一句话能回 · 零黑话 · 先结论再原因 · 技术选择题不塞给 PM。

**为什么**：Ad Strategy Engine spec 写完后一口气抛了 `go merge`、force-pause 守卫、migration `go apply`、P1-P5 阶段号，PM 直接回「看不懂你的问题」。改成「文档写完了，要不要现在合进系统？回 `go merge` 就行」之后立刻办了。

**影响**：写入 `CLAUDE.md`，对所有 agent 永久生效。

## 2026-07-13 · 客户对外内容必先 grounding 官网真实行程

**决策**：给客户写任何对外内容（reel / post / caption / 广告 / 邮件）前，必须先 WebFetch 客户官网真实产品/行程页。`master_briefs` 只给定位/受众/支柱，**不含真实运营细节**。发布前过一道 claim 审：逐句标「官网可溯 / brief 可溯 / 未证实」。

**为什么**：CTS 长城 reel 编了「日出登长城 / at DAWN」，官网真实行程是慕田峪 early start 全天、缆车上滑道下、无日出。PM 追问来源当场揭穿，已撤 Publer 排期。

**影响**：与「绝不凭空注入客户业务数据」是同一红线两面 —— 那条防编**数字**，这条防编**运营细节**。

## 2026-07-12 · GitHub Actions 定时 → Render Cron Scheduler

**决策**：`winner-reel-sync-daily` 的 schedule 从 GH Actions 移到 `render.yaml`，GH workflow 只保留 `workflow_dispatch` 手动触发。

**为什么**：GitHub Actions 的 scheduled run 是 best-effort，15:00 UTC 那次被静默跳过。

**影响**：新 cron 一律优先放 Render。目前只剩 `baseline-domains-monthly` / `goals-expiry-check` / `factory-worker-sweeper` 三个仍由 GH Actions 调度。

## 2026-07-11 · 遇卡点必自动化，人工兜底当作不存在

**决策**：第三方 UI 卡住 / API 未文档化 / 跨客户重复操作 —— agent 必须自己解决（深挖 UI 隐藏入口 → 官方 Graph API 直调 → 页面 context inject Ajax → DevTools 深度自动化 → 沉淀成 ME 产品能力）。绝不 handoff「请 PM / FDE / 客户老板去点某个按钮」。

**为什么**：CTS ThruPlay Pool Builder 加 4 个 winner Reel 时，Meta Ads Manager「使用现有帖子」没暴露 post 切换器，子牙 handoff「请 PM 手机 Business Suite boost」。PM 拍桌：「我不接受人工来做，考虑到未来的业务增长模型，还是需要自动化」。

**影响**：唯一例外仍是 ① 不可逆操作的 go-or-stop ② 客户真实业务场景 fact。

## 2026-07-11 · 图/视频引擎从 Higgsfield 切到 Muapi

**决策**：Content Factory 的图片与视频生成走 Muapi（`MODELSLAB_API_KEY`）。

**影响**：见 `docs/specs/2026-07-11-p21j-m2-muapi-spike.md`。

## 2026-06-13 · PM 角色边界

**决策**：PM 只决策业务 / 客户 / 钱 / 优先级 / 风险接受度。技术决策（分支策略、修复路径 A vs B、字段命名、测试覆盖、架构与接口契约）由子牙拍板 + 召其他 agent 复审，永不上抛 PM。

**为什么**：子牙一次抛了 4 个技术问题让 PM 挑，PM 拍桌「我无法回答，你给方案」。

**影响**：唯一例外 —— 不可逆操作（`gh pr merge` / `apply_migration` / `git push --force` / 删客户数据）必须 PM 显式 `go`。

## 2026-06-10 · 客户营销落地页必须建在客户自己的域名（红线）

**决策**：任何为客户做的对外营销页 / 销售页 / Lead 收集页，必须建在客户自己的域名下。**绝对禁止** `magicengine.com.au/<客户>/...` 这类 ME 域名子路径。

**为什么**：① 客户 SEO 权重必须积累在客户自己域名 ② 客户业务身份与 ME 身份严格隔离 ③ 客户老板看到自家活动页挂在供应商域名下会觉得品牌被绑架。子牙曾提议把 Oztop Walnut 清仓 LP 建在 `magicengine.com.au/oztop/walnut-clearance/`，PM 拍桌定为永久红线。

**影响**：实施路径改为 React/HTML mockup → Elementor Template JSON / WP 主题模板 → 客户侧 import → 表单 webhook 回调 ME API。ME 只做内部工作台 / Discovery 落地页 / 自家品牌页。

## 2026-06-08 · 核心引擎从 GIMPT 改为 DAPE

**决策**：ME 核心引擎重定义为 **DAPE** = Discovery → Analysis → Prescription → Execution 四段循环 + AI 贯穿全程 + 6 大支柱矩阵（SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品）。

**为什么**：原 GIMPT（Goal / Initiative / Marketing-plan / Prescription / Task 共 11 层）是早期工程师视角的层级堆叠，客户和 FDE 都讲不清。

**影响**：完整 spec `docs/specs/2026-06-08-me-dape-redefine-v0.2.md`（949 行，5-agent 签字）。**对外文案用大白话「发现-分析-处方-执行」，DAPE 字眼仅 ME 内部技术文档使用**（板桥强约束）。

## 2026-06-05 · Agent 审查协议

**决策**：大任务（触碰安全/隔离/鉴权 · 加表或改 schema · 新增对外 endpoint/UI · 跨多文件 >3 commit · 引入新依赖 · 影响已上线功能）必须 **子牙（架构）+ 魏征（挑刺）至少 2 审**；面向 C 端客户的**必须加板桥**；触碰隔离/安全核心的实施后**补狄仁杰**攻击验证。

**为什么**：一次把 6 个 P3 二期问题全堆给 PM，PM 回「看不懂」；事后魏征 + 板桥筛选只剩 3 个真商业决策。

**影响**：「我自己审过了」不算 2 审 —— 必须不同 agent。

## 2026-06-05 · 新表 migration 的 RLS 一律 service-role 模板

**决策**：新建表 migration 的 RLS policy 固定写法：`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "service_role_full" ... FOR ALL TO service_role USING (true)`（包在 `DO $$ ... EXCEPTION WHEN duplicate_object` 里）。禁止引用 `clients.workspace_id`（不存在）、`client_team`（不存在）、`auth.uid()` / `auth.jwt()`（ME 没用 Supabase Auth 做 end-user 鉴权）。

**为什么**：审计发现 13 处 schema 漂移（9 表未建 + 4 列缺失），根因是早期 migration 的 `CREATE POLICY` 引用了不存在的对象，apply 时炸在 policy 步骤、**整个事务回滚** —— 文件在仓里但 DB 里啥都没建。影响 19 客户关键词排名 cron 全瘫 + 5 个模块功能。

**影响**：写完 migration 必须 grep `workspace_id\|client_team\|auth\.uid\|auth\.jwt`，命中就重写。

> ### 🔴 2026-08-03 修正：`TO service_role` 不是可选项，漏了就是对外敞开
>
> **上面这条决策原本的模板漏了 `TO service_role`**，写成 `FOR ALL USING (true)`。
> Postgres 里 `CREATE POLICY` **不写 `TO` 子句 = `TO PUBLIC` = 对所有角色生效**，
> 包含 `anon`。而 Supabase 默认已给 `anon` / `authenticated` GRANT 了 public schema
> 下所有表的增删改查 —— 平时全靠 RLS 兜底，这个模板等于把兜底拆了。
>
> 策略名字叫 `service_role_full`，实际谁都能用。**名字骗了所有人两个月。**
>
> **实测**（2026-08-03，用生产环境公开 anon key —— 它随浏览器 bundle 公开分发）：
> 匿名可读 `outbound_prospects` 2,678 行、`conversation_messages` 2,135 行、
> `contact_identities` 1,260 行；匿名 `PATCH` 返回 204（可写）。
> 共 118 条策略中招（105 表全权限 + 10 INSERT + 2 UPDATE + 1 SELECT）。
> 未波及：第三方令牌、充值消费记录、客户账号表 —— 那几张的写法恰好是对的。
>
> 修复：`20260803020000_rls_lock_policies_to_service_role.sql`（用 `ALTER POLICY`
> 只改角色不动条件，无裸奔窗口）。
>
> **今后自查**：写完 migration 除了 grep 上面四个禁用对象，**再 grep 一次
> `FOR ALL USING`** —— 中间没有 `TO service_role` 就是这个洞。
> 或直接跑：
> ```sql
> select tablename, policyname from pg_policies
>  where schemaname='public' and roles::text='{public}'
>    and coalesce(qual,'true')='true' and coalesce(with_check,'true')='true';
> ```
> 除 `local_cities_read_all`（城市名参考数据，刻意公开）外应为空。

## 2026-06-02 · ME 定位升级

**决策**：从「营销自动化平台」→「**以 Goal 为中心的生意指挥平台**」。Kanban 汇总所有能帮客户达成 Goal 的因素，营销只是其中一条战线。

## 2026-05-27 · Phase 19 API 鉴权整改（IDOR）

**决策**：三层修复 —— L1 session-cookie 鉴权 + 移除 `NEXT_PUBLIC_INTERNAL_API_KEY`；L2 `requireClientAccess` per-client 授权 helper；L3 轮换 `INTERNAL_API_KEY`。

**为什么**：审计发现全部 89 个 `/api/clients/[id]/*` 路由系统性 IDOR，根因是 `INTERNAL_API_KEY` 经 `NEXT_PUBLIC_` 前缀编译进浏览器 bundle，约 33 个 dashboard 文件的 bearer-token 守卫虚设。

**影响**：硬约束 —— 19.A + 19.B 必须在给客户建员工登录账号之前完成（账号一建立，IDOR 即变外部攻击面）。已完成（PR #95）。

## 2026-05-19 · Phase 12.Q 内容质量闭环

**决策**：(1) **覆盖 Phase 13「campaign_briefs 不扩 schema」的决策**，加 6 个 nullable 字段（offer / target_audience_detail / proof_points / primary_cta / channel_goal / campaign_angle）；(2) quality rubric 走混合模式（规则可判维度走规则，质性维度走轻量 gpt-4o-mini），SDK client 由 route 注入、rubric 模块顶层不引用任何 SDK；(3) context snapshot 扩三张现有产物表，**不建 `production_packages` 聚合表**。

**为什么**：质量上限被 campaign context 缺失卡住，6 个 nullable 字段属低风险扩展。

## 2026-05-18 · SEMrush → DataForSEO 迁移

**决策**：现有 8 个 SEMrush 接口中 7 个可完整替换为 DataForSEO Labs 等效接口。

**为什么**：节省 96–99% 成本（SEMrush 按词计费 vs DataForSEO 按 task 计费）。数据质量相同（DataForSEO Labs 同源 SEMrush），唯一差异是 KD 算法口径不同，需在报告层注明。

**影响**：`src/app/api/semrush/` 已改名 `src/app/api/keyword-intelligence/`；`src/lib/semrush/` 已删除，入口改为 `src/lib/keywords/resolver.ts`。`SEMRUSH_API_KEY` 现已无代码读取（`render.yaml` 仍有声明，待清理）。**注意 `SEMRUSH_DB` 仍在用**（市场库标识 au/nz），不要一起删。

## 2026-05-17 · Phase 12 飞轮数据闭环启动

**决策**：
- 建 `flywheel_actions` / `flywheel_metrics` / `flywheel_outcomes` 三层数据骨架 + adapter 抽象
- **第 4 飞轮命名定为 `geo`**（替代历史命名 `insight_reports`）—— GEO 才是真正动手干活的引擎，月报独立为非飞轮的 `reports`
- 广告 vendor 策略：先用 Meta MCP 自建 adapter，markisfact 当「未来可插拔」备选。**硬约束 = 数据必须留在 ME 自己的表里，不管 vendor 是谁**
- 社媒飞轮形态 = 混合：自研内容制作（Atlas + OpenAI/Claude）+ 第三方发布（Publer）（Publer 已于 2026-10 删除）
- **AI Tracker 保留自建，不切 Apify `amernas/ai-brand-monitor`** —— 该 actor 不支持 AU/NZ 地域定位（默认美国视角，对全部客户失真），且状态 "Under maintenance" 不能做核心数据源
- **TikTok 广告库抓取未来用 Apify，不自建** —— 商品化数据采集，TikTok 反爬激进

**影响**：三种执行形态定为 `in_house` / `third_party` / `external_manual`；6 诊断维度不动，其中 `reputation` + `competitor` 只诊断不接飞轮。

## 2026-04-30 · 立项决策

- **三大核心**：SEO + GEO + 社媒内容矩阵；GEO 为 2026 Q2 核心差异化
- **商业模式**：年度陪跑服务（5–15 万/客户/年），不做 SaaS 月费
- **目标市场**：澳大利亚（AU）+ 新西兰（NZ）。所有功能必须默认 AU/NZ 上下文 —— 内容用 AU/NZ 英语拼写，时区 NZST/AEST，SERP 调用带 `gl=au`/`gl=nz`，AI Tracker 问句必须带地域标签
- **品牌封装**：客户可见层不暴露第三方真实供应商名（见 `CLAUDE.md`）

---

## 已作废的决策（别再按这些做）

| 原决策 | 何时作废 | 现在是什么 |
|---|---|---|
| **GIMPT 11 层引擎** | 2026-06-08 | DAPE 四段（见上） |
| **MLT（Magic Lab Token，$0.10 NZD）计费** | 被 Phase 20 取代 | **MTC**（Magic Token Coin），代码在 `src/lib/mtc/`。`MLT` 在 `src/` 中 0 引用。旧文档见 `archive/BILLING_TOKEN_SYSTEM.md` `archive/PLATFORM_ARCHITECTURE.md` |
| **Airtable × Zapier 自动化链路** | 逐步退役中 | Zapier 已完全不在代码里；Airtable 仅剩 3 处引用，审核已搬到 ME 驾驶舱 `/dashboard/factory`（PR #581）。旧 spec 见 `archive/AUTOMATION_SPEC.md` |
| **`magic-engine-tasks` background worker + `scripts/process-tasks.js`** | 2026-06-01 删除 | Render Cron Jobs（`render.yaml` 中 `type: cron`）。该端点从未真正实现过 |
| **部署推 `master` 分支** | — | 部署分支是 `main`。远程仍存在 `master` 分支，是历史遗留 |
| **Higgsfield 做图/视频引擎** | 2026-07-11 | Muapi（`MODELSLAB_API_KEY`） |
