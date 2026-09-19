# Magic Engine — 踩坑清单

> 每条都是**真实事故**，不是假想风险。开工前扫一眼，比事后复盘便宜。
> 新踩的坑请追加到对应分类，格式：**症状 → 根因 → 怎么防**。

---

## A. 配置陷阱（最容易静默失败的一类）

### A1 · `ATLAS_API_KEY` vs `ATLAS_CLOUD_API_KEY` 名字对不上 🔴

**症状**：图片 / 视频生成在生产上失败或返回 401，本地却正常。

**根因**：`render.yaml` 声明的是 `ATLAS_API_KEY`，但代码只读 `ATLAS_CLOUD_API_KEY`
（`src/lib/visual/atlas.ts:5`、`seedance.ts:6`、`wavespeed.ts:5`，三处都写死这个名字）。
Blueprint 里的名字和代码里的名字不一致时，Render 不会报错 —— 它只是给你一个 `undefined`。

**怎么防**：改 env 名字时 grep 全仓 `process.env.<旧名>`。跑 `bash scripts/doctor.sh --env` 会直接点名。

### A2 · `FACTORY_PUBLISH_LIVE` 未设 = 静默发草稿 🔴

**症状**：片子 `status=published`，三处落库全绿，FB 主页上却什么都没有。

**根因**：未配该变量时 Factory 走 dry-run 分支，只发 DRAFT。全链路没有任何一处报错。

**怎么防**：验完草稿格式后，PM 显式在 Render 设 `FACTORY_PUBLISH_LIVE=true` 才会真发。

### A3 · `APIFY_API_KEY` 和 `APIFY_TOKEN` 两个名字并存

**症状**：一部分 Apify 调用能跑，另一部分 401。

**根因**：代码里两个变量名都在读，但只配了其中一个。

**怎么防**：两个都配上，或统一成一个（未做，见 `ENV.md` §3）。

### A4 · `UPLOAD_LINK_SECRET` 未配时会 fallback 到 `CRON_SECRET`

**根因**：`src/lib/uploads/client-upload-token.ts:90` 写了 `|| process.env.CRON_SECRET`。

**风险**：轮换 `CRON_SECRET` 会顺带作废所有客户上传链接，且没有任何提示。

### A5 · 判「环境变量零引用」时只 grep `process.env.X` 会漏一大片 🔴

**事故（2026-08-01，本仓文档整理 PR #651）**：清理 `.env.example` 时按 `process.env.X` 判定零引用，
**误删了 9 个仍在用的 Voice Agent 变量**（`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `META_APP_SECRET` / `META_VERIFY_TOKEN` /
`TELEPHONY_PROVIDER` / `WEBHOOK_REPLAY_WINDOW_SECONDS` / `DEFAULT_HUMAN_TRANSFER_URI`）。
Codex 审出 5 个，人工复查又找出 4 个。

**根因**：`src/lib/voice/config.ts` 用 zod schema 声明变量名（`TWILIO_ACCOUNT_SID: z.string().optional()`），
读取时走 `parsed.TWILIO_ACCOUNT_SID` —— 全程不出现 `process.env.TWILIO_ACCOUNT_SID`。
后果不是「少一行模板」：生产环境（`isProd` 且没开 `MOCK_EXTERNAL_SERVICES`）这些 provider 落回 mock，
`voice/config.ts` 会**直接抛错拒绝启动**。

**怎么防**：
- grep **变量名本身**，不要 grep `process.env.<名>`；范围含 `src/` 与 `scripts/`（排除 `archive/`）
- 命中后逐个看上下文 —— 有的命中只是文档字符串举例（`SEMRUSH_API_KEY` 在
  `validation-utils.ts` 就是注释里的 `@param` 示例，那个确实零引用）
- 删任何模板项前，先问「有没有 schema / 配置中心 / 字符串拼接式读取」

---

## B. Migration / Schema

### B1 · migration 必须 PM 拍板，worker 严禁自行 `apply_migration`

**事故**：W4 / W5 两个 worker 都踩过 —— 一个把 P0 Kanban 搞崩，一个把 P→E 链路搞断。

**怎么防**：worker 只写 migration 文件，等 PM 显式 `go apply`。

### B2 · worker 报「已 apply migration」不能信，必须 SQL 验证

**事故**：W4 / W5 都误报过。

**怎么防**：查 `supabase_migrations.schema_migrations` 确认版本号真的在里面。

### B3 · RLS policy 引用不存在的对象 → 整个事务回滚，文件在仓里但 DB 里啥都没建

**事故**：审计发现 13 处 schema 漂移（9 张表没建 + 4 个列缺失）。根因是早期 migration 的
`CREATE POLICY` 引用了 `clients.workspace_id`（不存在）和 `client_team`（不存在），
apply 时炸在 policy 步骤。影响 19 个客户的关键词排名 cron 全瘫 + 5 个模块功能。

**怎么防**：新表 RLS 一律用 service-role 模板（见 [DECISIONS.md](./DECISIONS.md#2026-06-05--新表-migration-的-rls-一律-service-role-模板)）。
写完 grep `workspace_id\|client_team\|auth\.uid\|auth\.jwt`，命中就重写。

### B4 · 加 enum / status 新值必须同步前端 type + UI fallback

**事故**：`superseded` 状态加了 DB 没加前端，UI 直接崩。

**怎么防**：每次改 `type X = 'a' | 'b' | 'c'` 必须 grep 全仓 `Record` / `switch` / `STATUS_META` 的 key。

---

## C. Git / 分支

### C1 · 长命分支是万恶之源

**事故**：一次审 4 个 open PR（#460 / #455 / #452 / #448）发现**全部 dirty 无法 merge**，最老的放了 4 天。
两个 docs-only PR（2 文件 / 1 文件）也照样冲突 —— 全因抢改 `ROADMAP.md` / `CLAUDE.md`。
#460 描述说改 8 文件，GitHub 显示 78 文件 +4718 行 = 典型「分支基于旧 main、从没 sync」的 diff 虚胖。

**怎么防**：① 能合就几小时内合，别过夜拖天 ② 登记类改动拆独立小 PR 立即合
③ 新窗口开工先 `git fetch origin && git merge origin/main`（**永远 merge，永不 rebase** —— 本仓禁止 force push，
而 rebase 已 push 的分支必须 force push）④ merge 完必须重跑 build + 测试（文本不冲突 ≠ 语义不冲突）。

**警报信号**：「文件数 vs PR 描述对不上」就是分支漂移。

### C2 · 删分支前必须 verify PR 真的 MERGED

**事故**：PR #410 / #415 force push 完立刻 delete branch，实际 PR 还没 merge，代码丢了。

**怎么防**：`gh pr view <N> --json state` 确认 `MERGED` 才删。

### C3 · PR 动 `ROADMAP.md` 必须逐行扫 diff

**事故**：PR #353（修 goals 入口）merge 时意外删掉了 PR #348/#350 登记的 Phase 22.E S9-S13 + 决战日 schedule
共 105 行。下个 session 开工 S13 时 grep "S13" 返回 0 行才发现，靠 PR #359 才恢复。

**怎么防**：开 PR 前跑 `git diff main -- docs/ROADMAP.md`，确认所有 `-` 删除行都 100% 与本 PR 主题相关。
看到无关的 `-` 行立刻停手，从 `git show <base>:docs/ROADMAP.md` 恢复。

---

## D. 客户数据 / 内容（对客户伤害最大的一类）

### D1 · 绝不凭空注入客户业务数据

**事故 1（CTS）**：子牙凭空假设「queenstown inbound 旅游」—— 实际 CTS 做的是 outbound Kiwi→中国旅游。

**事故 2（Oztop）**：子牙编了 vinyl / herringbone / plantation shutters / sheer curtains 五个品类页，
还编了 18100 / 22200 的搜索量 —— 实际 Oztop 不卖 shutters / curtains / herringbone，数字全是编的。

**怎么防**：写任何客户 Goal / Initiative / 关键词列表之前，必须先
① 查 `master_briefs.{brand_name, core_proposition, target_audience, content_pillars, keyword_seeds}`
② 查 `clients.primary_keywords`。
搜索量 / KD / 月点击**必须来自 DataForSEO 或 GSC snapshots**，不能估、不能编。
任何 SEO 内容或 Initiative hypothesis 必须能在 `master_briefs` 或 `clients` 表里指明来源，否则停手问 PM。

### D2 · 客户对外内容必先 grounding 官网真实行程

**事故**：CTS 长城 reel 编了「日出登长城 / at DAWN」。查官网 Tale of Two Cities 的真实行程是
**慕田峪 Mutianyu、early start 全天、缆车上+滑道下、没有日出**。PM 追问来源当场揭穿，已撤 Publer 排期。

**怎么防**：`master_briefs` 只给定位/受众/支柱，**不含真实运营细节** —— 具体怎么安排只有官网行程页有。
发布前逐句标「官网可溯 / brief 可溯 / 未证实」，未证实的删掉或让 PM 确认。

**和 D1 的关系**：同一红线的两面。D1 防编**数字**，D2 防编**运营细节**，一样致命。

### D3 · 客户营销落地页绝不能建在 ME 域名下

见 [DECISIONS.md 2026-06-10](./DECISIONS.md#2026-06-10--客户营销落地页必须建在客户自己的域名红线)。这是永久红线。

### D4 · FDE/PM 要填的字段必须连 UI 一起做完

**规则**：任何需要在客户级别填的配置（`brand_aliases` / `competitor_domains` / `primary_keywords` /
GA4 property_id / GBP account_id / 任何 connector 配置），**必须连同 Settings 页 UI 一起做完才算 ready**。

**绝不能写**「让 PM 进 Supabase Studio 直填」/「FDE 跑 SQL UPDATE」这类 SOP —— 运营人员不应该碰数据库。

**判断标准**：如果某字段被 FDE 工作流读，它的写入路径必须是 ME 后台的可视化 UI。
只加字段不加 UI 就上线 = 产品缺陷，下一个 PR 必须补。
复用 pattern：`CompetitorDomainsPanel` / `PrimaryKeywordsPanel`（chip + add input）+ `/api/clients/[id]/{field}` 对称 GET/PATCH。

### D5 · 查了爆款配方，却只抄「改个数字就能满足」的那几列

**事故 1（CTS · 2026-07-20）**：给 CTS 做圣诞 reel，完全绕开已有的 `viral_reference_library` 和
`src/lib/reels/viral-style-advisor.ts`，手搓漂亮蒙太奇。PM 连批「结构/内容/音乐雷同」「空镜开场」。

**事故 2（CTS · 2026-09-03，同一客户、同一节日、隔 6 周）**：这次**查了**配方，从 58 条旅游爆款里
抽出镜长中位 2.14s、首切 2.83s、镜头数 14，卡着音乐小节切到零误差 —— 然后**开场仍然用长城空镜**
（配方明写 `scenic_beauty` 开场得分最低）、**每帧压 logo + 加尾卡**（配方明写是低分特征）。
PM 反馈「太平静」「一堆照片的串联」「这不是爆款短视频的结构」，跟 6 周前是同一句话。

**根因不是没查，是挑了软柿子**。同一张统计表里：
- 抄了的：镜长 / 首切 / 镜头数 —— **改个参数就能满足**
- 没抄的：`ugc-selfie`(出现 16 次，第一)、`drone-aerial`(11 次，第二)、真实感评分 6.35/10(最高维度)
 —— **必须换素材形态才能满足**

节奏抄满、内容形态一条没抄，产出就是「卡得很准的幻灯片」。

**同一会话还暴露了第二层**：这两条禁令**当时就写在 memory 里、摘要也在上下文里**，照样漏。
原因是那条记忆绑的是**任务标签**（"做 reel 前必须…"），而我给自己贴的标签是"搭模板"，对不上。
相比之下同一会话里绑**具体动作**的铁律 0（"只要要调外部 API，就先查 `src/lib`"）一次没漏。

**怎么防**：
① 触发条件绑动作不绑任务名 —— 见 CLAUDE.md §8「对外画面必先跑配方对账」。
② **必须产出一张对账表**（配方每列 → 这次做了什么 → 满足/未满足/不适用），在给 PM 看成片**之前**输出。
 判断类检查不写成表就会被跳过 —— 那次会话把切点验到毫秒、19 个素材逐个验 HTTP 200、
 8 条视频逐帧验运动，唯独「符不符合配方」没验，因为它没法一行命令跑出来。
③ 未满足的列要么补，要么在交付时**显式声明缺口**，不能沉默略过。

---

### D6 · 靠「渲一版给 PM 看」来发现问题，把一次能抓全的错拖成四五轮

**2026-09-04 CTS 圣诞团 reel**：一条 21 秒的片子，PM 连挑四轮——图选错（拿「一座临水的塔」当西安）、AI 糊脸（i2v 把西安街头真人和「小卖部」招牌、重庆「重庆你好」楼体字全涂糊）、logo 糊成半圆、BGM 混剪不丝滑。**每一轮我都是渲整片 → 下载 → 再发 PM 看**，一轮五六分钟。PM 直接问「怎么这么慢」。

**根因**：我在错的地方省时间。这些问题**全都能在分镜缩略图上一眼抓出来**，根本不用等整片渲完；但我省掉了自检，用「渲成片给 PM 看」代替了它 —— 把本该一次抓全的问题，拆成了「PM 挑一条 → 我改一条 → 重渲」的循环。

**怎么防**（见 CLAUDE.md §8「对外成片交付前必先出分镜自检表」）：
① 成片截成 9 宫格逐镜缩略图，**自己先过一遍**：图对不对（城市/地标/AI 糊脸糊字）· 文字对不对 · logo 完整清晰否。
② 图库图 / i2v 输出**必核对来源与内容**：搜索词命中 ≠ 内容正确（那张塔的摄影师只写了 "a tall pagoda"，从没说西安）；provenance 没指名地点的图不许打地名大字。
③ **i2v 逐帧重画，凡画面里有可读文字或人脸的镜头必崩**（兵马俑、西安街景、重庆楼体字三次实测），这类改走真实像素推进（Ken Burns），别送 i2v。
④ logo 这类**很宽的横向组合标**缩到水印尺寸后底部标语会糊成一片、纯白在亮天空上消失 —— 裁掉标语行、留完整图标、加顶部渐变遮罩。

---

### D7 · 给客户开一个新功能的授权开关，必须同时确认它依赖的所有其它开关也已到位

**背景（issue #1648，客户知识库上线阶段闸）**：`getClientKnowledge()` 对 `customer_reply` 有两道独立的闸——① 有没有被授权用这个功能（`client_automation_policies` 一行）② 这个客户是否已经走完双签流程正式"上线"（`client_knowledge_events` 的 rollout stage）。**两道闸都要过，缺一道，结果是静默返回空**（`{entries: [], forbiddenFactKeys: []}`），跟"这个客户真的没有知识库事实"完全无法区分——不报错、不告警，只是 AI 什么都不说。

**怎么防**：以后任何 FDE/PM 要给一个客户打开 `client_knowledge.read` 这类授权开关之前，先确认这个功能所有配套的前置状态（这里是 rollout stage 必须到 2）都已经就位，或者干脆走同一个流程一次性办完，不要把"给权限"和"走完上线手续"当成两件可以分开、可以先后顺序随意的事——前者一旦单独打开，后者没跟上，问题不会报错提醒你，只会在客户那边表现成"AI 什么都不知道"，排查起来毫无线索。

**这不是留白，是故意设计的默认最不放行**：换个角度看，这套机制的存在就是为了让"AI 对客户说什么"这件事永远需要经过明确批准，宁可暂时什么都不说，也不要在没人真正确认过的情况下开口。

---

### D8 · 只靠 fact_key 命名约定传递"这条事实是什么类型"，写入侧没有任何强制，等于没有契约

**背景（issue #1579/#1580，CTS Verifier v3 改接客户知识库，子牙+魏征复审 2026-09-15 共同指出）**：`client_knowledge_facts.visibility='forbidden'` 的事实，`getClientKnowledge()` 在任何用途下都不返回正文（`statement`/`structured_value`），只把 `fact_key` 报给调用方——这是刻意设计（防止连 Verifier 的调试日志/人工复核界面都意外泄露"这个下架产品叫什么、为什么下架"）。`src/lib/messenger-agent/verifier/policies/cts.ts` 因此把"能不能识别这个 fact_key 对应哪个产品"的全部信息编码进 `fact_key` 命名约定本身（`tour.active.<code>` / `tour.retired.<code>[.alias.<slug>]`）。

**问题**：这套命名约定**只存在于 `cts.ts` 的注释里**，负责写入知识库的两条路径都不知道、也不检查它——萃取工作流（issue #1645）的抽取 prompt 是刻意行业中立的通用 prompt（不该、也不会知道"CTS 团要叫 `tour.retired.xxx`"这种客户专属规则）；FDE 审核页（issue #1646）只是"批准/改后批准/驳回"已经产出的候选，UI 上没有任何地方提示格式要求。这意味着如果录入时 `fact_key` 拼错前缀（比如打成 `tours.retired.xxx` 或 `tour.retire.xxx`），这条记录会在 Verifier 的所有闸门里**静默隐形**——不报错、不告警，只是从此在 gate 2/3/5/7 里都"不存在"，跟这个功能要解决的原始事故（下架团被当成在售报给客户）是同一种失败模式，只是换了个失效点。

**怎么防（当下已做的最小止血 + 真正要做的）**：
1. 已做：`parseActiveProductFact`/`extractForbiddenProductSlugs` 对"看起来想写 `tour.*` 但拼错前缀"的情况打 `console.warn`（只能覆盖"还是 `tour.` 开头但后半段拼错"这类典型笔误，不是穷尽校验）。
2. **未做、已开 issue 跟进**（[#1726](https://github.com/bigbigraydeng-maker/magic-engine/issues/1726)，P3）：任何"某个模块靠 `fact_key`/字符串命名约定传递业务语义"的设计，如果写入这张表的路径不止一个、且其中至少一个路径是通用/跨客户的（本例是行业中立的 LLM 抽取 prompt），就不能只在读取侧的注释里定契约——要么在 FDE 审核页加格式校验/提示，要么在心跳监控里加"有多少条记录的 fact_key 不匹配任何已知命名约定"这类可观测统计，把"静默不生效"变成"看得见的数据质量问题"。
3. 上线前的 T-14d dry-run（design doc `~/.claude/plans/cts-tours-messenger-dynamic-pearl.md` 的验证计划）必须包含至少一条走完整"萃取 → 审核批准 → Verifier 核验"链路的真实数据用例，而不是只用手写的、已经跟约定对齐好的测试 fixture 自证闭环。

---

### D9 · Meta 视频广告"投放位置"留默认自动 + 优化目标是"看完成本最低"，预算会被系统自动导向 Audience Network 奖励视频，数据看起来很好但都是假信号 🔴

**背景（2026-09-16，CTS 两个账户 7 天数据深挖发现）**：CTS 两条以"看完视频"为目标（`optimization_goal=THRUPLAY`）的广告——个人账户 `ThruPlay - NZ - Reels`（广告组 `120248221094190307`）、官方账户 `GC 顶层 · ThruPlay · 4 条各 $10`（广告组 `52549857906273`）——建的时候"投放位置"都没有手动设置（`targeting.publisher_platforms` 为空 = 留给系统"自动版位"）。实测两条广告过去 7 天分别有 **95%（$77.45/$81.38）和 97%（$308.99/$317.01）的花费与曝光，全部落在 `audience_network/rewarded_video`（Audience Network 奖励视频——用户在第三方手游里为换游戏内奖励被迫看完广告的场景，不是 Facebook/Instagram 版位）**，完播率高达 97%–99%，但这是"被迫看完换奖励"造成的假信号，不代表真实兴趣。

**根因**：`optimization_goal=THRUPLAY`（"用最低成本换看完次数"）+ 投放位置留自动 = 系统会自动找全网最便宜的"看完"来源，Audience Network 奖励视频正是这类库存里最便宜、完播率必然接近 100% 的一种（用户是被游戏奖励机制"绑住"看完的，不是被内容打动）。这两个因素任一单独存在都不必然出问题（比如只做留资/私信优化目标的广告组，同账户里几乎不受影响——参照组数据显示留资类广告 97%+ 花费落在真实 FB/IG 版位），必须两者叠加才会触发。

**连带影响**：从这两条被污染广告的视频建立的自定义受众（再营销/相似受众的种子池）同样被污染——CTS 官方账户的"GC 北京+上海视频看完95%"受众（`52551117275273`，用于 9/13 上线的收割 A/B 测试）**规则里的两条视频 100% 来自被污染的官方账户广告**；更大范围的"看过任意 CTS 视频 50%"受众（16 条视频的规则）里也有至少 5 条视频来自被污染的个人账户 ThruPlay 系列。这些受众建成后曾被当作"证明内容爆款"的证据引用过（已知的"13,000+ 人看完 95%"表述曾被指出是重复观看而非独立触达人数，这次发现的是另一层、更深的问题：即便只看独立触达人数，其中相当一部分本身就不是真实感兴趣的人）。

**怎么防**：
1. 任何 `optimization_goal` 是纯播放/完播类（THRUPLAY、`video_view` 等，不落地到留资/私信/购买这类真实商业结果）的广告组，建的时候必须显式设置 `targeting.publisher_platforms`，手动排除 `audience_network`（或至少排除 `rewarded_video` 这个具体版位），不能留给"自动版位"。
2. 建广告组后必须按版位（`breakdowns=publisher_platform,platform_position`）回读一次花费/完播分布，确认没有异常集中在某一个版位——不能只看汇总层面的完播率数字，汇总数字会把一个占 95%+ 花费的坏版位和一堆占比很小的好版位平均成一个"看起来还不错"的数。
3. 用视频观看数据建自定义受众（再营销/相似受众种子）前，先确认视频来源的广告本身版位健康——被污染广告的观看事件不应该被当作"真实兴趣信号"用来建种子受众。
4. 已排期的动作：广告引擎（`~/.claude/plans/ads-impact-loop-capability.md`）阶段 1 的诊断表 `ad_entity_snapshots` 已经存了 `targeting_summary`（含版位设置），后续诊断应该加一条"纯播放类优化目标 + 未排除 Audience Network"的规则检测，把这类配置错误自动检出，不必每次靠人工深挖 7 天数据才发现。

---

## E. 匹配 / 算法逻辑

### E1 · token equality 漏掉 80% 的多词品牌

**事故**：`brand_search_volume` 用 token 相等匹配品牌词，CTS 的 "cts tours" 匹配不上域名根 "ctstours"，
统计出来只有 ~5 次品牌搜索（真实值 166）。

**怎么防**：新增 `clients.brand_aliases` 字段 + substring 匹配（不污染原 `isBrandedKeyword`）。
SOP：`docs/sops/brand-aliases-setup-for-gsc.md`。

### E2 · 通用词表整张启用 → 顶满 100 个结果 slot

**事故**：Oztop 跑 keyword gap 返回 100 个词全是 shutters/blinds/windows（27.1K 月搜/条），但 Oztop 不卖这些。
根因：`BUILDING_SUPPLIES_TERMS` 通用词表含 shutter/blind/curtain，只要 domain hint 含 flooring/oztop 就整张表启用。
影响所有「卖部分建材类别但不卖全部」的客户。

**怎么防**：`isBusinessRelevantKeyword` 加 `excludedTopics`，**排除检查必须在 business-relevance 之前跑**。
数据源是 `master_briefs.excluded_topics`，配套 `ExcludedTopicsPanel` UI（符合 D4）。

### E3 · 把整段文本压成一整条 slug 再做子串匹配，句子边界和产品名前缀关系都会制造假阳性

**事故（子牙+魏征复审 2026-09-15 各自独立用真实数据复现，CTS Verifier gate 2 上线前拦下）**：`src/lib/messenger-agent/verifier/policies/cts.ts` 的"下架产品提及"闸门最初把整段回复文本一次性 `slugify` 成一条 kebab-case 字符串，再用 `.includes(禁止slug)` 判断。两个独立复审各自手算出一个会误伤合法回复的真实案例：
1. **跨句拼接**：句号/换行被当成普通分隔符压扁——"…a full day in Shanghai. Surroundings like Zhouzhuang…" 会拼成 `…shanghai-surroundings-like…`，精确命中一个真实存在的下架团 slug `shanghai-surroundings`，但这两个词分属两句话、语义完全无关。
2. **产品名前缀关系**：CTS 真实产品线里 `china-icons-collection` 恰好是 `china-icons-collection-christchurch` 的 slug 前缀——如果前者下架、后者仍在售，任何合法提到 Christchurch 那个团的回复都会被子串匹配误判成提到了下架团。

**怎么防**：不要把"一大段自由文本"整体压成一条字符串再做子串匹配——① 先按句子边界切分，只在同一句话内部匹配，避免相邻句子的词被拼在一起；② 用词序列（token 数组）比较而不是字符子串比较，命中后额外检查这次匹配是否其实是某个更长的、合法存在的同类实体（这里是仍在售的产品）名字的前缀延伸，如果是就不算命中。这两条对任何"把一批禁止关键词/黑名单跟一段自由文本做匹配"的场景都适用，不只是这一个 gate。

---

## F. 运维 / 调度

### F1 · 7 个 cron 端点根本没有调度器

**症状**：功能「上线了」，但从来没自动跑过，也没有任何地方报错。

**清单**：`admin-key-expiry` · `benchmark-accumulator` · `kpi-backfill` ·
`memory-extractor` · `poster-studio-daily` · `factory-review-sweeper`（最后一个是有意退役）。
`flywheel-seo-weekly` 已于 2026-09-07 上线（PM 拍板开，改挂 Inngest 定时器），不再属于本条。

**怎么防**：新建 `/api/cron/*` 路由的同一个 PR 里就要加 `render.yaml` 条目。
`bash scripts/doctor.sh --cron` 会列出所有「有路由无调度」的端点。

**2026-09-07 补的自动闸**（`src/lib/cron/registry.test.ts`）：任何地方只要调了 `startCronRun`，
就必须出现在 `CRON_REGISTRY` 里，或在 `UNSCHEDULED_CRON_ROUTES` 里写明为什么不排班，否则测试红。
判据是「谁调了 startCronRun」而不是「哪个目录下的 route.ts」—— 按位置扫的话，
把调用挪进 `src/lib/inngest/functions/` 就能让一个任务从对账里静默消失（改这条时当场踩到过）。
白名单自己也被查：排上班了 / 路由没了，都会红。

### F2 · GitHub Actions 的 scheduled run 是 best-effort

**事故**：`winner-reel-sync-daily` 的 15:00 UTC 那次被静默跳过。

**怎么防**：定时任务一律优先放 Render Cron。GH Actions 只留 `workflow_dispatch` 手动触发。

### F3 · viral-analyzer-worker OOM 导致 cron 连锁宕机

见 `docs/history/2026-viral-analyzer-worker-oom-incident.md`。

### F4 · 本地 worker 不在跑 = 工单永久卡在 queued

**症状**：Factory 有新工单但没人认领，界面上看不出问题。

**根因**：`scripts/factory-worker/worker.mjs` 跑在某台 Mac 上，仓库里**没有 launchd / pm2 配置**，
进程挂了没有任何告警。

**怎么防**：上机 `ps` / `pm2 list` 确认；改了 worker 逻辑后要确认进程重启过（否则还在用旧逻辑）。

### F5 · 系统「知道」问题，但没有任何一处会走到人眼前

**事故（2026-08-01，一天撞出三件）**：CTS 一篇 blog 的 PR 开好后躺着没人知道（待办只统计 `draft`
不统计 `pr_open`）；Oztop 2 个页面谷歌不收录、网站页面数据 65 天没更新（主机商挡了我们的服务器）。
三件事系统全都有数据，但都只停在日志里。

**反模式**（三条都算「没下发」）：
- ❌ 发现写进 `cron_run_logs.summary` / `console.error` 就算完事 —— 那不叫下发，叫埋掉
- ❌ 卡片只说「Resubmit for indexing」不说去哪点 —— FDE 得先自己研究一遍，等于没下发
- ❌ 系统做不了就 silent skip —— 静默降级必须同时产出一条人工任务，或一条可见的数据断流标记

**怎么防**：自动化确实做不了的，一律下发到今日待办「🙋 需要你动手」栏
（`src/lib/pm-todo/manual-items.ts`），并带齐 what / how / href 三件套。见 [CLAUDE.md 铁律 3](../CLAUDE.md)。

### F6 · 外部接口报错被吞成空数组 = cron 报「成功、0 条」

**事故（2026-08-15）**：CTS 的评论自动回复每 30 分钟扫 149 个帖子，生产日志里每小时刷出大量
Meta 400 —— `(#10) 缺 pages_read_user_content`、`(#100/33) 帖子不存在`、`(#12) 老式 status 端点已下线`。
而 `cron_run_logs` 里那一轮写的是 `ok: true, new_comments: 0`。**从运行记录上看不出任何异常**，
客人在帖子下面提的问题一条都没被看见。

**三个根因，每个都单独致命**：
1. `fetchPostComments` 把**所有**失败（400/超时/限流）一律 `return []` —— 调用方分不清「没有评论」和「读不到评论」；
2. 传给 `/comments` 的是拆过的裸 post id，Graph 把它当成老式 singular status 对象 → `#12`。要传 `<page_id>_<post_id>` 全 id；
3. 广告账户里混着**别人主页**的素材，用本主页 token 去读一律 `#10` —— 那批根本不该问。

**怎么防**：
- 外部接口的失败必须**带着原因**回到调用方，至少分「重试有意义 / 重试没意义」两类。吞成空数组 = 制造静默失败；
- 重试没意义的（缺权限 / 对象没了 / 端点下线）要**记住并跳过**，且带过期时间 —— 人补好权限后要能自己恢复，不能靠谁记得回来清标记；
- 缺权限这类只有人能修的，走「🙋 需要你动手」（见 F5），别只留 `console.error`。

### F8 · `&&` 串两条 curl：守的是「网关有没有超时」，不是「上一步有没有跑完」

**症状**（2026-08-17 ~ 09-07，销售的客户需求卡停更 14 天）：`render.yaml` 里
`curl 私信同步 && curl 写需求卡`。同步的服务端耗时那天从约 25 秒跳到约 140 秒，
网关**约 125 秒**掐断连接返 524 → `curl -f` 退出码 22 → `&&` 短路 →
**第二条 curl 从此一次都没执行**。而服务端每一轮都跑完了、每一轮都写了运行记录，
监控上一路全绿：「私信同步每小时正常」945 次。

**判据错在哪**：意图（「同步没跑成就别拿半截数据写卡」）是对的，`&&` 也确实在守一个信号 ——
只是那个信号回答的是「网关有没有在超时前把响应给 curl」，不是「这件活儿有没有干完」。
**服务端跑完 ≠ 客户端收到响应。** 只要接口耗时逼近网关那条线，两者就开始分家，
而分家那天不会有任何告警。

**顺带一条查案纪律**：第一版判断写的是「闸门在 100 秒」，据此推出 8/21、8/22 那两天
「按机制该是 0 张卡」却有 25 次运行 —— 对不上。**没粉饰这个对不上，回去查了 501 条运行记录**，
边界实测在约 125 秒（跟着跑成功的最大 124.5 秒，没跟着跑的最小 124.98 秒，零反例），
那两天正好在这条线上下浮动。机制判断对不上事实时，错的通常是机制判断里的那个数。

**怎么防**：
- 跨步骤接力走 Inngest（铁律 3）：上一步跑完发事件带机器可读回执，下一步作为消费者。
  判据从「curl 的退出码」换成「服务端自己的回执」；
- `render.yaml` 里**任何 cron 都不许用 `&&` 串第二个 `/api/cron/` 调用**
  （`src/lib/cron/registry.test.ts` 已锁死，加回去当场红）。串在后面的
  `&& curl hc-ping.com/...` 健康检查上报不受影响 —— 它漏掉的方向是「误报没跑」会响，
  漏掉一件活儿的方向是安静地不干、不会响；
- 一个请求跑 160 秒以上的活儿，本来就该拆段：拆成 Inngest 的 step，每段一个请求，
  失败只重试那一段。

---

### F9 · Supabase 一次最多返回 1000 行，而且不报错

**症状**：把「按人逐个查」改成「批量 `.in(...)` 查一次」提速时，命中 1000 行上限的那次
拿回 1000 行就当读全了，剩下的静默消失。放在补档案这条路上的后果是某人的开场白那条消息
被截掉 → 他的电话邮箱永远补不上 → CRM 卡片继续写着「没留电话」，销售照着它跑去私信回，
而客人在等电话。**答案是错的，但没有任何一处报错。**

**怎么防**：批量查询一律配 `.range()` 分页读完，并且**稳定排序**（排序列同刻并列时用 `id` 兜底，
否则分页边界上的行会在两次请求间换位，重复或漏行）。读失败要返回 `null` 之类的**失败态**，
不要返回空数组 —— 空数组跟「这个人真的没有数据」长得一模一样。

---

---

## G. 协作 / Agent

### G1 · 「我自己审过了」不算 2 审

大任务必须 **子牙 + 魏征**至少 2 个不同 agent；面向 C 端加**板桥**；触碰安全核心实施后补**狄仁杰**。
同级别 agent 互查、挑遗漏角度才是价值所在。

### G2 · Codex 会虚报

**事故**：Codex 声称修复完成，仓库里根本没有那个 commit。

**怎么防**：Codex 交付的 PR merge 前必须子牙复审，重点查
① commit 真实存在 ② 测试数量对得上 ③ **变异测试**（故意改坏校验逻辑，看对应测试会不会 fail，防空架子测试）
④ 边界覆盖（Codex 容易只写 happy path）⑤ 架构旁路（校验必须在最里层，确认没有 API 绕过）。

### G3 · PM 反问 ≠ 删除指令

看到 PM 问「这个还需要吗？」不要直接动手删。先读意图，再确认，最后才动手。
见 `~/.claude/rules/coding-style.md`「删除代码前的强制流程」。

### G4 · 一个分支同一时间只允许一个窗口开

并行任务用 `git worktree` 物理隔离。接力同一大任务用同一分支，全新任务基于最新 main 开新分支。

**实测撞过一次（2026-09-15，PR #1693 `feat/knowledge-rollout-stage-gate`）**：一个窗口在修这条分支跟主线的冲突，两轮复审跑到一半，分支远端又被另一个没有登记窗口契约的会话推了新提交上去（新增两个路由 + 一处竞态修复），复审中途拉代码发现分支比开审时又长了一截。这次运气好——两边改动没有互相覆盖，最终复审重新跑通过了；但这属于事后才发现，本该在动手前查一次分支是否已有人在改（`git log origin/<branch> --oneline` 对一下时间线），而不是审完才意外碰上。
