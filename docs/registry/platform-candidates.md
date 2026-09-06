# ME 平台候选清单（L1 / L2 Candidates）

> **载体地位**：本文件是 [me-platform-tier-gate](../../.claude/skills/me-platform-tier-gate/SKILL.md) 强制候选登记的**唯一权威载体**。skill 判定为"L1 / L2 候选但证据不足"时，必须登记进本表，不许"下发到日志里"。
>
> **为什么在 git 而不是数据库**：v1 起步阶段，跨 worktree 走 git 同步足够；管道存在性优先于最终形态。晋升到 Supabase 表见本文件末尾"演化路径"。

---

## 为什么存在

`me-platform-tier-gate` 的核心机制之一是**默认降级 + 硬证据晋升**：单客户提出的 **Capability / Playbook 语义**需求默认落 L4/L2 实现，同时登记为"L1 候选"—— 凑齐硬证据后自动触发晋升提案，走 2 审进 Build Gate。

> **本表只约束 Capability / Playbook 语义，不适用于 L3 Connector**：符合 L3 判据（provider-specific adapter 挂在既有 Capability 下、不同客户可用不同 Connector 组合）的单客户需求，本就是 L3 的常态用法，**不需要**先落 L4/L2 再登记候选，也不占用"L1 候选"名额——判定为 L3 就直接按 Connector 走，不进本表。详见 [SKILL.md](../../.claude/skills/me-platform-tier-gate/SKILL.md) 红线 3。

这套机制的前提是**候选清单必须真的存在**。没有实体载体 = 候选永远不会被复查 = 相同逻辑在多个客户 config 里各复制一份 = 平行系统蔓延（正是平台化原则禁止的）。

---

## 硬证据晋升判据（复述自 skill 红线 3）

- **L1 晋升**：≥2 个**已付费**客户分属**不同行业**提出同一需求，或某 L2/L4 实现已在 **≥3 客户处出现事实复制**
- **L2 晋升**：同一行业内 ≥2 个客户出现事实复制（跨行业不适用）
- 达标后自动触发晋升提案 → 强制走 2 审（子牙 + 魏征）→ 进五道 Build Gate

---

## 复查节奏

- **月度提醒已接入自动待办，不靠人记日期**：每条候选的"复查日"必须同时登记进 [`src/lib/pm-todo/platform-candidate-reviews.ts`](../../src/lib/pm-todo/platform-candidate-reviews.ts)。复查日一到，既有的 `pm-daily-todo` cron（render.yaml 已排班，NZ 工作日早晨自动跑）会把这条候选生成一条"需要你动手"待办发给 PM/FDE——**登记候选却漏写这个文件 = 复查永远不会被提醒**，跟只写日历一样会断头
- 复查当天由当值 FDE 主持跨客户配置相似度扫描，把新增证据填进表；复查完成后同步把该候选在 `platform-candidate-reviews.ts` 里的 `reviewDate` 推到下一次复查日，否则待办第二天会重复出现
- **季度**：PM 审阅本表，决定哪些候选可推进晋升、哪些应放弃
- **随时**：任何 agent / worktree 发现新证据，直接追加进对应候选的"硬证据进度"列（不需要等复查日）

---

## Schema（表头列定义）

| 列名 | 含义 |
|---|---|
| 候选名 | 一句话描述这个候选能力是什么 |
| 建议层级 | L1 Capability / L2 Playbook |
| 归属 | ME 6 支柱哪一柱 / 平台基础设施 / 待定 |
| 来源客户 | 首次提出的客户 |
| 来源行业 | 首次出现的行业 |
| 硬证据进度 | 已凑齐几个不同行业/客户的证据（如 `1/2 行业`、`1/3 客户复制`）|
| 当前状态 | `candidate` / `promotion_proposed` / `promoted` / `abandoned` |
| 首次登记日 | YYYY-MM-DD |
| 复查日 | YYYY-MM-DD（下次复查时间）|
| 登记人 | 哪个 worktree / agent / PM 登的 |
| 备注 | 关键上下文（PR 链接、事故链接、判据讨论链接）|

---

## 候选清单

<!--
表格保持 markdown 格式，方便 grep 与 diff。
第一行示例已注释。
-->

| 候选名 | 建议层级 | 归属 | 来源客户 | 来源行业 | 硬证据进度 | 当前状态 | 首次登记日 | 复查日 | 登记人 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|
| 借助 Claude Design 生成品牌 VI 视觉资产（logo · 品牌手册 · 视觉规范）| L1 Capability（候选 · 需硬证据）| 待定 · VI 不在 6 支柱 · **PM 拍板项** | HBay Water | 瓶装水 / FMCG | 1/2 行业（仅 HBay）| candidate | 2026-08-27 | 2026-09-27 | happy-cori-796b21 worktree | HBay Deploy 档扩展；PM 明确 ME 借助 Claude Design 做；未来 CTS / Roman / 其他客户若也用同类能力则可升 L1；Low bar 登记（skill v2 首例）|
| 行业市场研究报告出品能力（署名 "Magic Insight 数据研究院"，面向高级会员定期出品行业级市场研究）| L1 Capability（候选 · 需硬证据）| 平台基础设施：Investigate / Market Intelligence 的一条产出通路（横切既有 6 支柱，**不新增第 7 支柱**）| ME 自主产品线（**非客户提出**，2026-09-03 PM 看到 Vol.01 成稿后提出固化为常规能力）| 旅游（Vol.01 中国入境游）+ 物流（Vol.02 中国→澳洲零散单）| **0/2 计入**——两卷虽已出稿，但均在数据核查中暴露严重问题，按"证据必须是硬证据"原则不计入晋升进度 | candidate | 2026-09-03 | 2026-10-03 | cts-tours-governed-agent-9ca5df worktree | **本条登记的首要价值是记录一次数据完整性事故，而非记录成功案例。** 事故：Vol.01（旅游）与 Vol.02（物流）两份对外报告在起草时**未跑任何一次实时数据查询**——未调 DataForSEO、未 WebSearch、未抓 ABS/NIA/Auspost 任何一个数据源——却给自造数字配上了权威来源标注（"ABS International Trade in Goods"、"Google Ads Keyword Planner"、"国家移民管理局"、"Trip.com Group 财报"）。直接违反 CLAUDE.md 铁律 8「搜索量 / KD / 点击数必须来自 DataForSEO 或 GSC，不能估不能编」与「对外内容必先 grounding」。**事后核查实测（13 集群并行 + 对抗性反驳，2026-09-03）：150 条数字里 CONTRADICTED 64 · UNVERIFIABLE 32 · NO_SUCH_DATA_EXISTS 26 · CLOSE_BUT_OFF 15 · VERIFIED 仅 13。** 三类最危险的失败模式，应直接写进未来的发布前 checklist：① **凭空发明数据源**——Vol.02 引用「Freightos Baltic Index 澳洲航段」，而 FBX 全部 12 条航线里根本没有大洋洲航段；② **描述一项从未执行的调研**——Vol.02 §06 宣称「样本量约 40 家华资货代 · 审计时间 2026-08」并给出 16 项百分比，该审计从未发生；③ **真假掺杂最难识别**——Vol.01 北京客源表 8 国里，澳/英/德三个与官方《北京市接待入境游情况》2025 全年表逐位吻合（+62.0 / −4.0 / −5.0），另五个为编造且系统性低估增长（法国印为 −2%，官方实为 **+24.9%**，正负号相反），真数字反而给假数字背了书。⚠️ **本能力若要晋升，必须先把"实时数据拉取"做成流程硬闸而不是自觉**：ME 已有 `src/lib/dataforseo/search-volume.ts`（关键词量）、`serp.ts`（SERP 占位）、`src/lib/geo-baseline/provider.ts`、`src/lib/industry-ai-visibility/collector.ts`，产品化时必须复用，不得另起，更不得跳过。**该硬闸已随本次登记一并落地**（2026-09-03）：SOP 见 [`docs/sops/magic-insight-prepublish-data-check.md`](../sops/magic-insight-prepublish-data-check.md)，实现见 [`src/lib/magic-insight/prepublish-check.ts`](../../src/lib/magic-insight/prepublish-check.ts)（7 条规则 · 27 个用例全部取材自本次事故真实片段 · 已做变异探针验证），CLI 见 `scripts/magic-insight-prepublish-check.ts`（有 blocking 时退出码 1，可挂 CI）。闸门只覆盖"机械错"与"措辞风险"两类；"编造"类只能靠 receipt/产物强制，这是设计上的已知边界，不是遗漏。PM 已拍板的边界：会员绑定 = 499 档（通用+定制）· 发行节奏 = 不承诺 · 数据策略 = 三方公开源二次加工 + ME 现有抓取能力（不新增付费订阅）· 定位 = 高级会员服务附送，不独立收费。**PM 待拍板项 2 个**：① 法务边界（免责条款 + 三方数据引用授权，"ME 名义 + 研究院署名 + 发给付费客户"三信号叠加，建议正式发行前过一次法务）② 编委机制（总编 / Vol 主编 / 发布前数据核查 checklist）。子品牌 "Magic Insight" 使 VI 需与 ME 主品牌 VI 分开管理（见 [[reference-magic-engine-vi-package-location]]），未来若独立域名/子站属 PM 拍板项 |
| 品牌 VI 强制执行（brand tokens 中央注入所有客户交付物 · logo / 色 / 字体 / 风格）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Verification/Output 层 | CTS Tours NZ | 旅游 | 1/2 客户（HBay VI 生成完 但落地时也需同一执行层）| candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | 事故驱动登记：2026-08-28 CTS catalogue 生成时 agent 忘了用客户 logo，暴露"每次客户交付物都要重新想起去查 master_briefs"是治理漏洞。跟"HBay VI 生成"候选互补：一个产 VI 包，另一个在下游渲染管道里强制读取并应用。Low bar |
| Lead 温度打分（多因子：邮件打开频次+最近打开衰减+注册新旧+备注文字里的时间意向 → Hot/Warm/Cold）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Attribution/Flywheel 类 · CRM 模块前置 | CTS Tours NZ | 旅游 | 1/2 客户（仅 CTS，先做 Excel 过渡版）| candidate | 2026-09-02 | 2026-09-09 | customer-zero-page-readiness-cb2afb worktree | PM 明确"今后做到 ME CRM 系统里"；@张良 判定：底层多因子衰减打分框架跨行业通用，但具体因子语义（旅游"出行时间" vs 地产"挂牌时间" vs 建材"开工时间"）行业绑定，属 L2 Playbook 范畴，禁止硬编码进 shared runtime（红线2）。今天先落 CTS Excel 手工版（AG/AH 列，一次性批跑不挂常驻cron），7天后(2026-09-09) check&tune 阈值。等第二个客户提出同类需求再走硬证据晋升。Low bar |
| 客户官网结构化素材抓取（sitemap → 产品页 → 图片 → 品牌片段）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Discovery/Read 层 | CTS Tours NZ | 旅游 | 1/2 行业（CTS 单例）| candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | 2026-08-28 为 CTS 起 catalogue 时手动跑过一次：sitemap → 4 团页 + 5 城 guide + visa guide + blog + 5 张官方 supabase 图。跨行业本就通用（地产 / 电商 / 建材客户都要），只是每次现拼；Low bar 登记等 ≥2 行业事实复制 |
| HTML → PDF 多页排版渲染（A4/A3 print / 品牌一致的多章节 brochure）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Output 层 | CTS Tours NZ | 旅游 | 1/2 客户 | candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | 2026-08-28 CTS catalogue v1 用手写 CSS 完成，可 @page A4 → Save as PDF。行业无关：地产楼盘手册 / 建材 spec sheet / 电商 lookbook 都需要。Low bar |
| ME 旅游版 Catalogue Chapter Playbook（旅游行业 catalogue 的 chapter 结构 / 素材抓取通道 / 版式规则）| L2 Playbook / Industry Version（候选）| ME 旅游版 · **PM 拍板 ME 旅游版是否立版** | CTS Tours NZ | 旅游 | 1/2 客户（仅 CTS）| candidate | 2026-08-28 | 2026-09-28 | customer-zero-page-readiness-cb2afb worktree | PM 2026-08-28 定性："这种 PDF 的定期生成是一个 ME 旅游版很好的技能"。前置：ME 旅游版是否正式进 `docs/registry/product-versions.md`（PM 拍板项）。旅游 catalogue 的默认 chapter：Cover / Trust / Why now (visa/season) / Cities / Tours / Comparison / Culture Tips / Booking / Back cover。Low bar |
| Current-Sponsored Competitor Discovery（当前活跃广告主实时发现 + diff 竞品清单）| L1 Capability | 竞品 支柱（主）+ 广告 支柱（次·只发现不投放）· IMPACT Inspect 段 | CTS Tours NZ | Outbound Tourism (China 线) | **3/3 客户复制已达标** —— P30 seed 已在 CTS + 22 家 tourism domains 事实复制；PM 列出 9 客户跨 6 行业需要（旅游 / 地产 / 电商 / 地板 / 留学 / 瓶装水）| candidate | 2026-08-28 | 2026-09-28 | 主 session（CTS 竞品扫描） | PM 2026-08-28 quote "但是我觉得这个也是一个 capability"；张良 v2.1 Full Report 判定 L1；配套 L3 新增 Google Ads Transparency Center Adapter；相关 issue: `me2.0-punch-list`（待建）；DataForSEO SERP L3 已存在（`src/lib/dataforseo/serp.ts`）；跨 AU / NZ 市场语义一致；hardcoded 客户名 / 行业 = ✗（走 `clients.primary_keywords` + `industry`）|
| 创作者专属 collection + 独立 UTM（每个合作创作者一个可归因落地页） | L2 Playbook | 社媒 支柱（主）+ 归因（次·复用既有 attribution 能力，不新增能力线） | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅 Aelfric Eden 外部观察，未在任何 ME 客户落地） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自 `docs/strategy/2026-08-30-aelfric-eden-ecommerce-teardown.md` §7.1；Jing's Pick 落地前须先跑带基线/成本/Outcome 判据的小范围实验（见该文档 §8），不得直接批量执行 |
| 内容排产输入从"想主题"改成"读客户 products.json 上新 feed" | L2 Playbook | 社媒 支柱 | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅 Aelfric Eden 外部观察） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.2；候选方向：ME 已有内容工厂加一个上新监听 |
| 促销走购物车层折扣叠加、不批量改 `compare_at_price` | L2 Playbook | 广告 支柱（主）+ 口碑 支柱（次） | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（因果机制本身未验证，见文档 §5） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.3；需先在本店核实促销实现机制，再在其他店验证 |
| 电商 SEO 检测方向：aggregateRating 空评分 / hreflang 适用性判断 / sitemap 内部垃圾过滤 | L2 Playbook | SEO 支柱 | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅 7/969 商品页抽样，见文档 §6.1/§6.2 订正） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.4；开 issue 落地前须先扩大抽样、按订正范围收窄适用条件 |
| AI agent 能否直接购买（Shopify UCP / agents.md 是否平台默认开放）作为 AI 可见度测量口径候选维度 | L2 Playbook | AI 可见度 支柱 | Aelfric Eden（外部研究对象，非 ME 客户）| 电商（快时尚 DTC） | 0/2 客户复制（仅本店观察，未核实是否为 Shopify 2026 平台默认能力） | candidate | 2026-08-30 | 2026-09-30 | claude/ecstatic-lichterman-a56dac（PR #1253 Codex 复审补登记）| 来自同上文档 §7.5；需查 Shopify 官方文档或再扫多家兼容店铺才能定论 |
| 跨源交叉验证与对照实验设计（用独立数据源互证结论 · 用对照组排除替代解释） | L1 Capability | 平台基础设施：Verification 机制（不属 6 支柱任一柱） | ME 自主研究（**非客户提出**，无付费客户需求背书） | 跨行业（旅游 to C + 会奖 to B 两次） | **0/2 付费客户提出**；ME 自用 2/2 次复制（澳洲赴华市场扫描 · MICE 入华市场扫描，均 2026-08-30） | candidate | 2026-08-30 | 2026-09-30 | docs/register-crossval-candidate | 登记前已做现状盘点。**判据库范式不需新建**：`src/lib/geo-measurement/` 已把「未知三分法」（`GeoUnknownReason`：not_recorded_by_source / not_applicable / source_ambiguous）、可比性判定与 5 个 validator 冻结成机器判定；`market-intel/grounding.ts` 已实现摘要事实核对（抽实体+数字回原文比对）。**真正缺的只有两件**：① 跨源交叉验证（本次用搜索量排序 × 广交会官方国别排序互证）② 对照实验设计（本次 A/B/C 三组，排除「查错词」与「中国特别差」两种替代解释）。⚠️ 本次探针阶段用临时脚本重复调了 DataForSEO 与 AI 可见度，而 `src/lib/dataforseo/search-volume.ts`、`src/lib/geo-baseline/provider.ts`、`src/lib/industry-ai-visibility/collector.ts` 均已存在——产品化时必须复用，不得另起 |
| AI 单页站生成器（事实采集 → AI 文案 → 模板渲染 → 静态发布） | L1 Capability（候选 · 需硬证据）| 平台基础设施：Provisioning & Activation（不属 6 支柱任一柱 · IMPACT 前置地基）| ME 自主产品线（**非客户提出**，来自 2026-08-31 会员制度 v1.1 定价决策） | 跨行业（AU/NZ 中小生意通用）| **0/2 付费客户提出**；0/3 客户事实复制（尚未实现） | candidate | 2026-08-31 | 2026-09-30 | musing-mendeleev-e892ba worktree | 来自 ME 会员制度 v1.1：免费档 = 永久免费二级域名站，$39 档 = 换自有域名+可被搜到+公司邮箱+去角标。Issue #1273（生成器 · B 级）· #1274（免费档 · A 级）· #1275（$39 订阅 · A 级）· #1276（扫街预建站 · A 级），四张均为 SPEC DRAFT 未授权实施。**Build vs Buy 已评估**：per-site 计费的白牌建站平台（Duda $17 USD/站/月 · Lindo ~$9 USD/站/月）在 $39 NZD 档毛利勉强，但在扫街预建站场景（为尚未付费的商家批量预建数百站）成本直接爆炸，故渲染/发布/托管判定 Build；**视觉模板判定 Buy**（买 premium HTML 模板授权，不手拼视觉排版，与 Shopify 主题教训一致）；域名+邮箱 Buy（#1269 OpenSRS）。⚠️ 实现前必须复用既有封装：Site Analyzer / `src/lib/dataforseo/` / `src/lib/gbp/` / `src/lib/ai/` / `src/lib/mtc/budget-guard.ts`，不得另起直调 |
| 开放第三方 developer 入驻，共建 ME 新功能/能力（类似插件市场/开发者生态） | 待定 · 不是技术层级分类问题 · **商业模式决策 · PM 拍板项** | 待定（取决于开放范围，可能横跨多支柱）| ME 自主产品线（**非客户提出**，会员分档设计讨论中 PM 提出的构想）| 跨行业（若做，天然是平台级）| 0/2（纯构想，无客户提出过，无实现证据）| candidate | 2026-09-02 | 2026-10-02 | 98ae562c worktree（张居正会员分档设计讨论）| 提出场景：讨论"还能加什么新功能"时，PM 提出未来新功能可以走第三方 developer 共建的路子。**不是**"这个功能归哪层"的问题——收费/分成模式、第三方代码质量与安全审核、客户数据访问边界，量级与"ME 要不要从 Connector 抽佣"同类，已列入 me-platform-tier-gate 的 PM 拍板项清单。需要单独展开一次讨论，本次会员分档设计里只登记不展开 |
| Governed Lead-Reply Agent（结构化事实驱动的广告留资对话生成 + 发送前防幻觉/禁用清单校验引擎，接管 Messenger/WhatsApp 等渠道的黑箱平台自带 AI 客服）| L1 Capability | 平台基础设施（不挂靠 6 支柱，比照 Kernel / Measurement Contract / Verification 一档）| CTS Tours NZ | Outbound Tourism (China 线) | **2/2 行业（PM 批准）**——CTS Tours（旅游，已付费）+ New Asian Logistic（物流，**即将签约·尚未付费**）；⚠️ 红线 3 字面门槛写"已付费"，New Asian 目前是"即将"非"已付费"，PM 2026-09-01 明确知情后拍板批准 L1，本条按"PM 已知情况下接受风险、提前启动候选评审"记录，不代表证据链已完全满足字面门槛；New Asian 正式签约后需补一条实锤 | promotion_proposed | 2026-09-01 | 2026-09-15 | 主 session（CTS Messenger Business AI 知识源失控排查） | 触发场景：Meta Business AI 把 ctstours.co.nz 官网仍挂着的停推团当真实数据报给客户，删商品卡/删网站字段/写强制指令均拦不住，唯一管用的是逐条"改进 AI 回复"打补丁——暴露 Meta 平台自带黑箱 AI 不可控、且无发送前校验闸。PM 明确"不属于广告支柱"直觉判断正确，改判为平台基础设施而非广告支柱场景应用，也不需要 PM 决定"是否新增第 7 支柱"。渠道接入（Messenger Send/Receive API + Handover Protocol、WhatsApp Cloud API）判 L3 Connector 挂在本 L1 下，不占本表名额；各客户具体知识（CTS 团清单、New Asian 运价/航线清单）下沉 L4。PM 已批准进入 promotion_proposed，下一步需子牙（架构）+ 魏征（挑刺）2 审后方可进五道 Build Gate；复查日/2审窗口设 2026-09-15（短周期，因 New Asian 签约状态未定需尽快确认）。同步登记于协作仓 [magic-engine-jundong-collab#11](https://github.com/magic-engine-dev/magic-engine-jundong-collab/issues/11)——⚠️ PM 2026-09-01 明确知情后拍板推翻该协作仓"客户模块/客户文档均未导入"的既定隔离原则，保留 CTS Tours / New Asian Logistic 真实客户名，非默认操作 · Tracking issue: [#1290](https://github.com/bigbigraydeng-maker/magic-engine/issues/1290) · **2 审进度（2026-09-01）**：已跑 4 轮 2 审（v1 一轮 + v2 一轮对卡） · 子牙 12 FIXED/5 PARTIAL · 魏征 10 FIXED/9 PARTIAL/1 NOT_FIXED · 双方 CONDITIONAL PASS · v3 补丁 9 条（1 blocker + 8 high）已列 issue #1290 · 9-15 启审前吸收；本地方案：`~/.claude/plans/cts-tours-messenger-dynamic-pearl.md` |
| Meta 广告受众管理与类似人群能力（建/改自定义受众 + 建 Lookalike 类似人群 + audience-ladder 接线到触发点）| L1 Capability（候选 · 补既有广告能力缺口）| 广告 支柱 · IMPACT Act 执行层 | CTS Tours NZ | Outbound Tourism (China 线) | 1/2 行业（CTS 单例 · 但跨行业本质通用：所有投 Meta 广告的客户都需要「找相似新客扩量」+「管理再营销池」）| candidate | 2026-09-06 | 2026-10-06 | cts-facebook-ads-strategy-b90ca3 worktree | 2026-09-06 CTS「三层漏斗组合拳」打法设计中发现。ME 广告执行栈（`src/lib/product-map/registry/ads.ts` = `operating_legacy` · 已上线真跑，非 dry_run）有两个受众能力缺口：① `src/lib/meta/audience-ladder.ts:304` `createLadder()` 建自定义受众的库能力已造好，但全仓**无任何路由/cron caller**（"造好没插电"）② ME 自建层**无「建 Lookalike 类似人群」和「改受众成员/加 users」入口**，只能裸调 Meta API。两块所有投 Meta 广告的客户都需要。PM 2026-09-06 拍板「先补平台 · 这是需要复用的能力」，选 A（补平台优先于 CTS 单点裸调 Meta）。@张良 判定 **L1 · 补齐既有广告支柱执行层缺口**，非新支柱、非新能力线（广告能力本已是 L1 operating_legacy）。**复用要求（红线）**：受众能力接入后必须复用既有 `draft-and-gate` 治理链（起草→暂停→回读→人点头审批）与 `MetaAdsAdapter` 结果回流，**不得另起**。红线 2：CTS 具体受众定义（`video_view_50` / `leadgen dropoff` 等）是 **L4 客户配置**，禁止硬编码进 shared runtime。晋升硬证据：待第 2 个不同行业已付费客户提出同类需求（Roman 地产 / Oztop 建材投 Meta 时天然需要）。开发按大任务走：详细设计 → 子牙+魏征 2 审 → PM 确认 → 五道 Build Gate。Low bar 登记 |
| 三层漏斗广告打法剧本（认知→线索→再营销→回传闭环 · 骨架通用 + 分行业配方）| L2 Playbook（行业配方剧本 · 骨架属广告支柱 L1 通用方法论）| 广告 支柱 · IMPACT Prescribe/Act | CTS Tours NZ | 旅游（Outbound Tourism China 线）| 1/2 行业（CTS 旅游单例 · 骨架跨行业通用但配方需逐行业验证）| candidate | 2026-09-06 | 2026-10-06 | cts-facebook-ads-strategy-b90ca3 worktree | 2026-09-06 CTS 三层漏斗打法成型时 PM 拍板固化为可复用模板。**骨架**（顶层认知攒受众池 → 中层线索表单 + 类似人群扩散 → 底层再营销收割 → 成交回传 FB 闭环）= 广告支柱通用方法论，跨行业通用（Roman 地产 / Oztop 建材可套同一骨架）。**分行业配方**（三层预算分配比例 / 创意类型 / 客群定向）= 行业剧本，换行业必改：旅游=便宜线索·55+金主·短决策（30/45/25）；地产=高单价·长决策·顶层建信任更重；建材=B2B 询盘·客群装修公司非退休游客。CTS = 旅游版首个样板，下个旅游客户可近乎直接套。@张良 判定：骨架 L1 方法论（隐含既有广告支柱，不单列 L1）；可迁移沉淀价值在 L2 分行业配方剧本。晋升硬证据：待第 2 个不同行业客户套用并验证配方有效。红线 2：CTS 具体预算数字 / 受众 / 素材 / 账户 = L4 客户配置，不进 shared runtime。关联同批「Meta 广告受众管理与类似人群能力」候选。Low bar 登记 |
| B2B 潜在客户线索发现引擎（ICP 定义 → 源人群抓取 → 多层漏斗筛选：规模/真活跃度/契合信号 → 证据分级 → 可溯源候选名单）| L1 Capability（候选 · 需硬证据）| 平台基础设施 · Discovery/Read 层 · IMPACT Inspect 段（不属 6 支柱任一柱，比照既有「客户官网结构化素材抓取」一档）| New Asia Logistic（物流 · **即将签约·尚未付费**）—— 首跑场景来源；本次 AU 跑为 **ME 自主通用调研，非付费客户提出** | 跨境电商找 3PL 进口商场景（NZ + AU 两跑同属**同一场景**，非两个独立行业）| **0/2 付费客户跨行业**（New Asia 未付费 + AU 为 ME 自用）；ME/客户自用 2 跑但同属"电商找 3PL"一个场景 → 按 issue #1419 与红线 3 判定**不构成有效独立跨行业证据**，证据仍不足 | candidate | 2026-09-07 | 2026-10-06 | zealous-williamson-6bc9e6 worktree | **诚实计数说明**：issue #1419 原文假设本条已存在并要把 AU 跑记为"第二份行业证据"，但核对主分支该候选行此前**并不存在**（本次首建），且两跑同属跨境电商找 3PL 一个场景，故**不按跨行业证据计入**，状态保持 `candidate` 不 promote。**方法（四层漏斗，可跨行业复用的是引擎骨架，非信号配方）**：① Apify `storeinspect/shopify-store-search` 按 12 个中国进口关联品类抓 AU Shopify 店（每品类封顶 300）去重 → 3600；② 规模筛（剔 Shopify Plus 401 + 年营收<$100K 878）→ 2321；③ 真活跃度（用 products.json 最新商品 `created_at` 30 天内，**不用 sitemap lastmod 假信号**）→ 1283；④ 官网政策/关于/FAQ 页扫中国进口关键词分级 → 已证实 **10** · 高概率 **382** · 不确定 249 · 无信号 642，每条留官网原文片段可溯源。**引擎 vs 配方分层**：抓源→多层漏斗→证据分级 = L1 引擎骨架跨行业通用；"中国进口关键词/products.json 上新"= L2 场景配方，换地产/留学客户必改；客户专属 ICP 与成品名单 = L4，禁进 shared runtime（红线 2）。**复用要求**：仓内已有 `src/lib/prospecting/`（pipeline/score/analyze/outreach 等，司马徽/张骞 outbound 冷邮线）与 DataForSEO 封装，未来产品化必须评估复用，不得另起——**但 `src/lib/prospecting/` 的泛化评估是 PM 未拍板的独立架构任务，本次不动代码**。交付物：在线报告 Artifact https://claude.ai/code/artifact/88e68c8b-0a05-4477-a04d-2d1a4ac52862 + 候选名单 CSV（在 PM 的 Claude App）；追踪 issue [#1419](https://github.com/bigbigraydeng-maker/magic-engine/issues/1419)。晋升硬证据：待 ≥2 个**已付费**且**不同行业**客户提出同类需求，方可走 2 审晋升。Low bar 登记 |

<!--
示例（不作为真实条目）：
| 跨客户舆情监控引擎 | L1 Capability | AI 可见度 + 竞品 支柱 | CTS | 旅游 | 1/2 行业（仅 CTS） | candidate | 2026-08-27 | 2026-09-27 | happy-cori-796b21 worktree | 来自 HBay 诊断报告能力线 04 |
-->

| AU/NZ 本地商业目录批量登记 SOP（NAP 文案模板 + 目录清单，供未来客户 onboarding 复用）| L2 Playbook（候选 · 证据极弱）| SEO 支柱（本地引用 / NAP 一致性） | Magic Engine 自己（Customer Zero，非付费客户提出）| 跨行业（AU/NZ 中小企业通用，非行业特定）| 0/2 客户复制（仅 ME 自己用过一次；Business Networking NZ 一条 listing 已提交待审）| candidate | 2026-09-02 | 2026-10-02 | dazzling-benz-6e6da3 worktree | 2026-09-02 实测 6 个目录（Google Business Profile / Bing Places / Yellow Pages AU / Hotfrog / True Local / StartLocal）——**仅 GBP 有公开 API 且 ME 已接入**（`src/lib/gbp/location.ts`/`publisher.ts`/`auth.ts`），但该 API 只能管理**已验证**的 location，不能代客户绕过 Google 的人工验证（明信片/电话/视频）新建 listing；其余 5 个均无公开 API，只能人工/浏览器逐个提交表单，且多数还要求先开平台账号（Google/Microsoft/站内账号）才能新增或认领 listing，本会话按安全规则不能替 PM 完成账号创建这一步。**结论：不构成可编码的 Capability**，最多是可复用的客户 onboarding checklist（NAP 文案模板 + 目录清单 + "哪些需要客户自己开账号"提示），价值上限有限，暂不建议投入开发，仅作观察候选 |
*（第一条候选：HBay VI 视觉资产生成。Low bar 登记 · 待复查日 2026-09-27 由 L1 owner 评估晋升成熟度。）*

---

## 演化路径

**v1**（现在）：`docs/registry/platform-candidates.md` + `src/lib/pm-todo/platform-candidate-reviews.ts` 驱动的复查到期提醒
- 优点：起步成本零、跨 worktree 走 git 同步、可 grep、可 diff、复查节奏接了既有 pm-daily-todo cron 不靠人记
- 局限：无 schema 约束、无查询能力、**跨客户配置相似度扫描本身仍是人工**（自动化的只是"提醒该扫了"，不是扫描动作本身）

**v2**（未来触发条件：本表条目 ≥10 或跨客户相似度扫描本身自动化时）：Supabase 表 `platform_capability_candidates`
- 走 A 级 migration（治理层，冻结 head + service_role RLS）
- 自动扫描 job：跨客户 config 相似度检测 → 自动追加证据 → 达标自动开晋升 issue

演化时机由 PM 拍板，不由 skill 或 agent 自决。

---

## 历史

- 2026-08-27 · 建仓，为落地 [me-platform-tier-gate](../../.claude/skills/me-platform-tier-gate/SKILL.md) 的候选管道。子牙架构复审的必改问题 2。
- 2026-08-27 · 补两处：明确本表不约束 L3 Connector；月度复查接入 `pm-daily-todo` 自动待办（`src/lib/pm-todo/platform-candidate-reviews.ts`），不再只靠"当值 FDE 记日历"。Codex 复审必改。
- 2026-08-30 · 登记「跨源交叉验证与对照实验设计」候选。**登记前先做了现状盘点**：ME 已有判据库范式（geo-measurement 契约）、事实核对（market-intel/grounding.ts）与全部数据抓取封装（dataforseo / geo-baseline / industry-ai-visibility），候选范围据此从最初设想的「市场情报报告能力」收窄为仅缺的分析两件事。证据为 ME 自用复制，**非付费客户提出**，晋升判据尚未起算。
- 2026-08-31 · 登记「AI 单页站生成器」候选。来自 ME 会员制度 v1.1（免费 / 39 / 199 / 499 / 定制）的第一块砖。**登记前先做了现状盘点**：`src/lib/website-publish/` 只是 blog 推送状态机、`src/lib/site-audit/` 是反爬检测，仓库内确无站点生成器。证据为 ME 自主产品线需要，**非付费客户提出**，晋升判据尚未起算。
