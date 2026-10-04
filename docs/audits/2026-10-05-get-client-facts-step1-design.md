# getClientFacts() 第 1 步：设计与威胁模型（A 级，影子并行，不改任何渠道）

日期 2026-10-05 · v2（已并入子牙、魏征设计复审）· 来源：`docs/specs/2026-10-05-client-content-foundation-plan-v0.3.md` §3 第 1 步（该文件目前只在分支 `claude/zen-herschel-6ed7a4`、提交 `f836e4332`，尚未进 main）。PM 2026-10-05 回「做」。

## 层级（tier-gate Inline）
L1 平台基础设施（整合既有能力，不是新支柱）。读 `master_briefs` + `clients` 两张已有表，**不建表、不改迁移、不动 RLS**。聚合器里没有任何行业或客户词；行业事实形状（团期、房源）由后面步骤的 profile 注入，本步不碰。

## 对外契约（`src/lib/client-facts/`）
`getClientFacts(clientId: string, opts: { callerClientId: string | null }) → Promise<{ok:true, facts} | {ok:false, reason, detail?}>`，**永不抛异常**（整体 try/catch，任何 reject 都变 `ok:false`）。

- **只返回结构化对象，不返回 prompt 文本**。文本仍由 `brief-injector.formatBriefForPrompt` 唯一渲染；Reels 自写序列化器 `reels/generator.ts:280` 本 PR 不删不切，只标记「待切」。影子对比只比**事实层**，不比整段 prompt（`formatBriefForPrompt` 还吃 content_pillars、platform_strategy、products、brand_story_md，这些本步不在 facts 里）。
- 每个字段是 `{ value, source }`，`source` 写「哪张表哪一列」。
- `facts`：`client_id`、`brief {id, version, matched_by}`、`brand`（brand_name、tagline、core_proposition、brand_voice 子集、target_audience 子集、`website_host` 仅展示用）、`visual`（vi_colors、vi_style_keywords、vi_dos、vi_donts、可选 `logo` 引用——本步永远不填）、`taboos` 三级、`warnings: string[]`。
- **禁忌三级，不拍扁**，每级是 `{ items, status: 'set' | 'none_configured' | 'all_unusable', unusable_count, unusable_entries }`（`all_unusable`＝有条目但一条都没法匹配，扫 items 等于扫空集；`unusable_entries` 让回执能点名丢了哪些词；单个汉字算可用，其他文字至少 2 个字符；条目只清洗不截断：去零宽/软连字符，控制字符变空格）：
  - `redline_phrases`＝`clients.brand_redline_phrases`（硬扫）；
  - `topics`＝`master_briefs.excluded_topics`（话题级，匹配语义是**子串**，不是整词）；
  - `tone_words`＝`master_briefs.avoid_words` ∪ `brand_voice.avoid_keywords`（只提示）。
  - `none_configured`（null/缺失/空数组）与读失败（`ok:false`）严格区分；`none_configured` 同时往 `warnings` 写 `redline_phrases_none_configured` / `topics_none_configured`（以字段名为前缀，另有 `<tier>_all_unusable`、`<tier>_has_unusable_entries`）——下游硬闸见到它必须在回执里明说「没有红线可扫」，不能当通过。
  - `clients.brand_redline_phrases` 在库里是 `NOT NULL DEFAULT '{}'`，读到 null/缺键只可能是读坏了 → `client_malformed`，不当成「没配置」。
  - 字段存成字符串/对象，或数组里有非字符串 → `ok:false reason:'brief_malformed'`（clients 那列则 `client_malformed`），照 `draft-redlines.ts readList` 的口径。空串、纯空白、折叠后短于 2 字的条目不静默丢，计入 `unusable_count`。
  - 代码里没有「平台级硬红线」常量，往共享代码写词违反平台化铁律，所以 `redline_phrases` 只来自客户自己的列。
  - 旧列 `content_avoid` 不进 taboos（无编辑入口，来源不明）。
- **失败原因**：`invalid_client_id`｜`client_mismatch`｜`client_lookup_failed`｜`client_not_found`｜`client_malformed`｜`brief_lookup_failed`｜`schema_not_ready`（库返回 42703=缺列，意思是「数据库那张表缺一列」，不是重试能好）｜`no_active_brief`｜`ambiguous_brief`｜`brief_malformed`｜`isolation_violation`｜`unexpected_error`。
- **字段白名单**：`master_briefs` 只 select 明列字段（含 `project_id`、`created_at` 供过滤排序）；`competitive_notes_md`、`semrush_snapshot`、`source_file_urls`、`competitor_domains`、`brand_story_md`、`style_guide_md` 不 select、不返回；`clients` 只 `id, domain, brand_redline_phrases`。禁止 `select('*')`。返回值逐字段挑选，即使 select 被改坏也不会带出禁字段。规划里「`brand_story_md`/`style_guide_md` 扫描竞品备注」这一条**本步不做**（这两列整体不进返回值，等于切断而非扫描），写进 PR 的「不做」。
- **嵌套 JSON 只取明列子键**：`brand_voice` → `tone_keywords, avoid_keywords, formality, emoji_usage, language_mix, persona.name, persona.role`；`target_audience` → `interests, pain_points, age_range, location`。`formality`/`emoji_usage` 用枚举校验，不合法丢弃并进 `warnings`；数组最多 50 条、字符串最长 200 字、去控制字符。
- **「生效 brief」取法（只此一处）**：只取 `project_id IS NULL`（楼盘级 brief 不是客户级，绝不串）。① `status='active'`，`matched_by:'status'`；② 没有再回落到 `is_active=true AND status IS NULL`（迁移前遗留行），`matched_by:'is_active_fallback'`。**`status='draft'`/`'archived'` 即使 `is_active=true` 也不生效**（库默认 is_active=true，AI 草稿会带这个值，回落若接受它就是把没人审的草稿当生效版）。每条查询 `order version desc, created_at desc` 取 limit 2，不用 `single/maybeSingle`；最高 version 并列 → `ambiguous_brief`。
- 导出 `classifyBriefActivation(rows)` 纯函数供后续只读统计，要把「draft 且 is_active=true」单独计数。
- 无进程级缓存（模块里没有可变状态）。
- **身份**：函数自己不鉴权。调用方必须先过 `requireDashboardClientAccess(clientId)`（或是服务端流水线里可信的 clientId）。`opts.callerClientId` **必填**：传已鉴权身份的 clientId，不一致 → `client_mismatch`；`null` 显式表示「可信服务端流水线」。`clientId` 校验复用 `validation-utils.isUuid`（宽松，CTS 的 `c0000000-…` 也过），比较前两边小写。
- 官网主机名：`brief.website` → `source_website_urls[0]` → `clients.domain`，只收 http/https、去账号密码、转小写，只返回主机名；类型上标「仅展示，不是抓取白名单」。

## 威胁模型（A 级：跨客户数据边界）
| 威胁 | 防线 | 测试 |
|---|---|---|
| A 拿到 B 的字段（含禁忌词） | 查询 `.eq('client_id'/'id')`；返回前再核对；无缓存 | 两客户互取；两道防线各自单独直测（泄漏模式假库） |
| 楼盘级 brief 当客户级 | `.is('project_id', null)` | 只有楼盘级 brief 的客户 → `no_active_brief` |
| 草稿当生效版 | 回落只认 `status IS NULL` | draft+is_active=true 行不被取 |
| 查库抖动当成「没禁忌词」 | 任何 error/reject → `ok:false`；永不抛 | clients、master_briefs 报错各一条；Promise reject 一条 |
| 「没配」与「读失败」混淆 | 三态 + warnings | none_configured 与 ok:false 分开断言 |
| 竞品/抓取数据泄进内容 | 字段白名单 + 逐字段挑选 | select 串断言；返回 JSON 不含禁字段内容 |
| 伪造/传错 clientId | isUuid；callerClientId 必填 | 非 UUID、不一致、大小写、CTS 真实 id |

## 已知没防的（写进 PR，不假装防了）
`vi_dos`/`vi_donts`/`brand_voice.avoid_keywords` 是 AI 读竞品资料后生成的自由文本，可能夹带竞品名；本步只保证四个禁字段与两个长文本列不进来，**不扫这三个字段里的竞品名**，留给后续步骤。

## 不做
不切任何渠道（Reels、social-plan、route-a/b/c 都不改）；不碰产品/价格；不做品牌包/logo；不改 `knowledge/read.ts`、`public_content`；不改发布闸；不实现 `client_facts.pack.shadow_compared` 事件与 90 天命中统计（第 1 步后续「影子对比」PR，统计由 PM 用只读 SQL 先跑）；`keyword-relevance.ts:18` 写死的建材词不碰，仅在 PR 标注为后续清理项。

## 切换前必须先对账（不在本 PR 范围，写进 PR 正文）
现有禁忌消费者口径不同：`draft-redlines.ts` / `draft-listing` 把 redline ∪ avoid_words ∪ excluded_topics **全当硬扫**；本函数把 avoid_words 降为 tone_words（按规划）。切换前必须逐消费者对账：旧硬集合里有、新硬集合里没有的词，PM 看过之前阻断切换。

## 切换前对账补充（魏征实施复审第 D 条）
除 avoid_words 降级外，新旧口径还有 4 处不同，切换时逐条确认：① 取 brief：旧 `draft-redlines` 用 `is_active=true`+`maybeSingle`、不过滤 `project_id`（可能取到草稿或楼盘级），新函数取 `status='active'`+`project_id IS NULL`；② 没有 brief 时：旧代码仍返回客户红线，新函数整体 `no_active_brief`（统计第 3 条）；③ 数组里有 null/非字符串元素：旧 `readList` 过滤掉，新函数整体 `brief_malformed`/`client_malformed`，库里 `text[]` 带 NULL 元素的客户切换时会从「能用」变成「读失败」；④ 匹配语义：旧代码对纯 ASCII 短语整词匹配，topics 在 `keyword-relevance` 里是子串匹配，本函数只交付词表，不管下游怎么扫。

## 开放项
生产库 `master_briefs.excluded_topics` 列是否已 apply 未验证（迁移头写「未经 PM 批准不得 apply」）。未 apply 时本函数对所有客户返回 `schema_not_ready`——有意的 fail-closed，影子阶段没有下游消费者，不会伤到现有渠道。这是 PM 第一条只读统计。

## 测试要求
假库按表建模（`master_briefs`、`clients`，其它表直接 throw）、同时放 A/B 两客户行、真实执行 `eq / is / order / limit`、记录每次查询的表与 select 串、有「列注册表」（select 到不存在的列返回 42703）、有「泄漏模式」（无视过滤与 select 把 B 的行和禁字段全返回）。变异清单（每条必须看到测试变红）：去 `.eq`；去返回前 client_id 核对；去 clients id 核对；error 当空；`select('*')`；回落去掉 `status IS NULL`；`redline` 存成字符串不拒；同 version 并列不报 ambiguous；去 callerClientId 比较/去小写；UUID 换严格版；模块级缓存；去掉 `avoid_keywords` 并集；Promise reject 不捕获。
