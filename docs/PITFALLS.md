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

### B5 · 判断「schema 漂移」前必须 grep 该列全部历史 migration，不能只看引入它的那一条 🔴

**事故**（2026-09-21）：排查品牌别名设置面板**能加不能清空**的问题时，看到仓库里引入
`clients.brand_aliases` 的那条 migration（`20260624010000_client_brand_aliases.sql`）把它声明为
可以为空（nullable，无默认值），而线上库（`glbdnayojixmexgofbsd`）实际是 `NOT NULL DEFAULT '{}'`，
于是先入为主判断成「线上被手工改过、仓库没记录」，并打算新增一条对齐 migration 补记录。
实际上后续 `20260625000001_a21_goal_current_value.sql:35-41` 早就把这一列回填 NULL、
`SET DEFAULT '{}'`、`SET NOT NULL` 做齐了——按仓库全部 migration 重建的环境本就等于线上，
根本没有漂移，只是排查时漏看了同一列后续还被加固过。真正的 bug 只在接口代码：PATCH 清空别名时
仍写 NULL，数据库拒绝（23502），接口 500。这个 bug 从 6 月潜伏到 9 月才被顺手发现，但「schema 漂移」
是误判，不是事故本体。

**怎么防**：
1. 怀疑某一列「仓库和线上不一致」之前，先 `grep -rn <column_name> supabase/migrations/` 看该列
   有没有被后续 migration 再动过，不能只读引入它的那一条。
2. 只有 grep 完整历史后仍对不上，才是真漂移，这时才需要新增对齐 migration；此前的空判会让文档
   记错事故性质，也会多一条实际上什么都不做的 migration 去扫描/锁表。
3. 除非真有读取方靠 NULL 和 `[]` 区分行为，数组列一律存 `[]`，别存 NULL —— 少一个没有含义、
   却能把写操作打挂的状态。`clients.primary_keywords` / `clients.competitor_domains` /
   `master_briefs.products` / `master_briefs.excluded_topics` 四个兄弟接口今天还在写
   `cleaned.length === 0 ? null : cleaned`；2026-09-21 实测这四列线上仍是 nullable，所以暂时没炸，
   但任何一列被加上 NOT NULL，同样的 500 就会复现。

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
4. ✅ **2026-09-22 已实现**：这条检测规则（D9）已经写进 `src/lib/ads-strategy/portfolio/diagnostics/d9-placement-leak.ts`，接进每日内部诊断日报，不用再靠人工深挖 7 天数据。**已知限制**：目前打不到共用账户（CTS 跟 Oztop/30 Kiteroa 共用的个人账户 `act_2775766642787274`）——快照采集对共用账户整层跳过广告组设置抓取，覆盖共用账户需要先解决"设置抓了归哪个客户"的架构问题，暂未排期。

---

### D10 · 六步回执全绿，改出来的文案却是错的：自动改客户网站文案，要验「改成了什么字」，不是验「流程跑没跑通」🔴

**事故（2026-09-20 NZ 凌晨，SEO 标题周循环 v1 第一次真跑）**：自动开 PR 并自动合并了 2 条 CTS 官网改动，都是错的——
Liziba 轻轨站页面被换成了别的页面的关键词「how many days in chongqing」（chinatravel #199）；
「新西兰人免签去中国」页面的描述被改成暗示要办签证、有申请步骤（#200，跟页面事实正好相反）。
PM 发现后约 5 分钟用 GitHub 的 Revert 按钮撤回（#201/#202），随即关掉 CTS 的开关（`seo_config.meta_cycle_enabled=false`）。

**四个根因（PR #1816 代码级核实）**：
1. 关键词是拿「全站所有搜索词」按共有单词去配页面的，不是用这个页面自己在 GSC 里的搜索词——于是一个页面配到了另一个页面的词；
2. DataForSEO 的搜索量 / 难度没查到时，代码默认填 0 = 「难度 0，放行」——缺数据被当成最安全；
3. 搜索量、难度、对手标题这些数据算出来了，却从没写进 PR 描述——人看 PR 看不到任何依据，没法事前拦；
4. 被选中的候选中途失败时直接消失，不留任何记录。

**教训**：
- **六步的运行回执全是绿的，改出来的字是错的。** 回执只证明管子通了，不证明货对了。验收要看最终改出来的那句标题 / 描述本身。
- 自动改对外文案必须先过「信息完整闸门」：搜索量 + 难度 + 实时搜索结果前 3 都在、关键词确实属于这个页面，才许改；**缺一样就跳过并留原因，绝不默认填值**。
- 给某个客户打开自动改文案的开关之前，先跑一次演练（`dry_run`，不写任何东西）给 PM 看这一轮会改成什么，PM 点头再开。

### D11 · 客户原始素材直传进 Campaign，尺寸没人把关，发出去图歪了 🟡

**事故（2026-09-21，NM Medspa 暖场 7 帖）**：从 Dropbox 拿来客户原图（横版 4:3、2:3、3:4 各种比例），直接 INSERT 进 `client_assets`，再把 ID 填进 `social_plans`。Campaign UI 能显示图片，PM 批准后才发现比例全错——Facebook/Instagram feed 要求 4:5（1080×1350），横版图在 feed 里会被裁掉上下，竖版图比例不对也会留黑边。

**Jev 有没有参与？没有。** Jev 是从现有候选库里挑图的工具，这次是手动上传新素材，Jev 完全没介入。即使 Jev 参与了图片候选，它也不做尺寸校验——它评估的是画面内容，不是像素比例。

**根因**：
1. `client_assets` 表的插入流程没有尺寸校验，status='analyzed' 可以手动设，绕过了任何 AI 分析；
2. Campaign UI 的图片选择器不展示图片实际尺寸，选了也看不出来；
3. 没有在入库时用 ffprobe/sharp 检查宽高比。

**怎么防**：
- 手动上传客户原始素材时，**入库前先检查所有图片尺寸**：`ffprobe -v quiet -show_entries stream=width,height <file>`；
- 不符合 4:5（或最接近平台要求的比例）的图，先用 `ffmpeg -vf crop=...` 裁成目标比例再上传；
- 最终验证标准：看 Campaign UI 里的图片预览，确认图片无明显拉伸或黑边，再交 PM 批准。

---

### D12 · AI 探测调用失败，被当成「测出来是零」报给客户——「没测到」和「测了是零」必须在数据结构上分开 🔴

**事故（2026-09-21，诊断报告 AI 可见度）**：ME 的 OpenAI 账户 9-20 晚余额耗尽，此后所有调用返回 429。
诊断里的「AI 可见度实时探测」每次调 3 个问题，**3 次全部 429 失败，代码却记成「跑了 3 轮、0 次提及」**——
跟「真的问了 3 个问题、AI 一次都没提到这个品牌」在数据结构上一模一样。

9-21 那轮诊断跑完了 6 家客户，**5 家拿到了从没测过的 AI 可见度结论**：
East International 拿到 `critical`、优先级 95 的「你的品牌在 AI 里一次都没被提到」；
CTS / Oztop / NM Medspa / Roman HU 各拿到一条 `high` 的「相比上周在退步」（CTS 那条写着「上周 95 次提及，现在 0 次」）。
客户门户的诊断页和报告页直接读这张表，按严重度排序展示，critical 排最前。

**怎么一眼看出是假的**：这批探测耗时 6.5 秒，历史正常值 24–45 秒——3 次 429 是立刻返回的，根本没在等 AI 回答。

**根因**：失败路径和「问到了但没提及」路径共用同一个返回形状（`client_brand_rank: null`），且失败仍计入 `runs`。
只有「钥匙没配」走 `skipped: true`；调用真的发出去但失败（429 / 超时 / 模型报错）一律落进「跑了 N 轮、0 次提及」。

**教训**：
- **「我没测到」和「测了，结果是零」必须是两种不同的数据，不能靠同一个 `null` 表达。** 后者是对客户杀伤力最大的一类结论，前者什么都不是。
- 探测样本很小（3 个问题）时**失败要 fail-closed**：哪怕只有 1 个问题失败，剩下 2 个也不足以断言「有」或「没有」——失败的那个恰好可能就是会命中的那个。
- 缺数据时的默认值几乎总会朝某一边偏。这次偏的方向是「把客户说得更差」，还能拿来卖服务，性质比偏好更糟。
- 同类口径见 AI 可见度手册：测不出来要写「未能测量」，**绝不能写成 0 或 false**。

**修复（PR #1919，仅诊断期实时探测这一半）**：`isProbeConclusive()` 成为唯一判据——每一个问题都真的测到了，探测结果才可以支撑任何客户可见结论；
否则整维退回 `score: null`（系统里既有的「这一维测不出来」约定），产出 `ai_visibility_probe_failed` finding（带失败详情），不附证据。
真实的零提及仍然照常报 critical，有专门的守卫测试防止这条修复被过度矫正成「什么都不报」。

**⚠️ 同类路径尚未修复：周度快照聚合不过滤失败 run。** `ai-tracker/orchestrator.ts` 的 `aggregateSnapshot` 拉本周全部 `ai_visibility_runs` 时不排除 `error_message` 有值的行，
失败次数计入 `total_runs`、拉低 `mentionRate`。诊断的 `collector.ts:93` 一看到快照 `mentions_count === 0` 就直出 critical「Brand Not Mentioned by AI」，不检查这些 run 是不是真测到的。
生产数据表明 CTS 9-14 那周 `mentionRate` 被稀释了一半（408 次调用里 221 次失败）。此路径需 A 级独立修复，见 ROADMAP。

---

### D13 · 改在投的 Messenger 广告的素材，改完没回读，链接变成无效地址，广告被 Meta 拦停一整夜 🔴

**事故（2026-09-24 晚 → 09-25，NAL 广告账户 act_953025114498626）**：NAL 花费占比最大的一条留言广告
「物流_潜在客户_Message_8月」（ad `52589967399125`，广告组 `52589967398925`）在新西兰 9/24 16:51–18:31 之间被
`MagicEngine`（ME 系统授权账号）连续改了 5 次素材（改图、改文案/链接）。最后一次 18:31 改完，Meta 把它判成
「有问题」（严重错误 1815765「你使用的是无效外部链接」），此后约 23 小时零花费，直到 9/25 PM 发现「NAL 今天没消耗」才被查出。
这条此前每天约 $40–80；期间只有另一条 WhatsApp 广告在撑着。

**改动经过（Meta 账户操作记录，UTC）**：04:51 换成新素材「NAL 15s Animated」(`1674285390909584`) → 06:23 换成「Animated v2」(`1914843999534974`)
→ 06:27 **改回原始素材 `2157721242294126`，06:30 Meta 放行、恢复投放** → 06:31 又换成「Real Footage v3」(`1800872904269967`)，06:31:50 变成「需要更新」。
即：有人拿**这条花费最大的在投广告当测试台**试 3 个新视频素材，最后停在一个被拒的版本上。

**现场证据**（Graph API 只读，2026-09-25 查得）：
- 三个新素材都是用接口新建的 `video_data`，按钮 `GET_QUOTE` + 链接 `https://fb.com/messenger_doc/`，Meta 报严重错误 1815765「无效外部链接」。
- **根因（2026-09-26 实测定案）**：`fb.com/messenger_doc/` 是 Ads Manager 界面内部用的 Messenger 占位链接。**人在界面里建的素材可以带它；用接口建素材时 Meta 在创建那一刻就拒**——9/26 照抄原素材的整套设置（含欢迎语）只换视频，接口创建仍当场报 1815765。
  9/25 曾用「同账户 60 多个正常素材也是这个链接」推出「链接不是元凶」，错在对照前没区分素材是界面建的还是接口建的（那 60 个全是界面建的）。
- 账户本身正常（状态 1、无停用、无花费上限、付款卡有效）——所以「花费没了」第一反应查欠费/封号是查错了方向。
- 操作人是 `MagicEngine`（ME 系统令牌）。**换 15 秒素材本身是 PM 2026-09-24 的决定**（台账 `docs/ledger/2026-09-24-nal-messenger-15s-creative-3day-review.md`：「先不全停，换素材观察 3 天」），
  执行窗口的错在做法：替换了在跑的主力广告的素材、被拒后没回读。

**为什么拖了一整夜**：
- 我们的每日抓取只在世界时间切日，最新一个新西兰日永远漏；快照里那条广告的状态要到下一次抓取才变。
- 没有任何一处对「一条曾经每天花几十块的广告突然零花费」报警——花费监控只看账户总额，另一条 WhatsApp 广告在花钱，总额不为零。
- 改完素材的那个窗口没有回读「这条广告现在能不能投」。

**教训**：
- **改在投广告的素材（`update_ad_creative`）之后必须回读 `effective_status` 与 `issues_info`**：不是 `ACTIVE` 就算失败，当场改回，不许等下一次日抓取。
  改素材=重新过审，是有风险的「动手」，不是低风险的小调整。
- **别拿花费最大的在投广告当素材测试台。** 新素材要试，另建一条新广告（暂停状态建好、审核过了再放量），不要直接替换在跑的那条的素材。
- **接口建「点了开 Messenger」的素材，正确写法**（9/26 实测一次过审）：`object_story_spec.video_data.call_to_action = {type: "GET_QUOTE", value: {app_destination: "MESSENGER"}}`，
  **不写任何 link**；欢迎语放 `video_data.page_welcome_message`（从原素材 `asset_feed_spec.additional_data.page_welcome_message` 原样搬）。
- **判断「为什么被拒」前，先拿同账户正常的素材对照差异，且对照对象要跟新素材走同一条建法（界面 vs 接口）**。
- 测新素材要**另建广告组**（同一 CBO 系列内分同一份预算），别往正在跑的广告组里加新广告——Meta 把「组里新增广告」算重大改动，会重置那个组的学习期。
- **「花费为零」必须能分出：账户级（欠费/封号）、系列级、还是单条广告被拦。** 单条广告掉到零、账户总额不为零，是最容易被平均数掩盖的一类。
- 反复改素材会让系统重新学习 7 天（见 `playbook-ads-meta-general` §13），所以修复完要冻结，不要边修边试。

**修复（2026-09-25，PM 批准「改回」）**：把该广告的素材改回原始 `2157721242294126`，广告状态 ACTIVE；回读：`IN_PROCESS` → `PENDING_REVIEW` → **`ACTIVE`**（改回 04:26:30 UTC，Meta 04:28:59 UTC 放行，用时约 2.5 分钟）。
修完冻结 7 天不再改这条广告。花费是否恢复另查（放行后才开始计）。备注：账户记录里我这次改回的操作人也显示为 `MagicEngine`——
**凡是用 ME 系统令牌调接口的窗口，在 Meta 眼里都是同一个操作人**，所以 9/24 的改动无法仅凭操作人名字认出是哪个窗口。

**重测（2026-09-26，PM「重测」）**：9/24 的 3 天测试实际没跑成，改为同系列内新建广告组 `52600434864725`（定向 8 项与主力组逐项 diff 一致，归因只能设 1 天点击）+
新广告 `52600434893325`（15 秒实拍视频，文案/欢迎语与原广告相同，创意 `1776068287054802`）。Meta 约 4 分钟过审，三层 ACTIVE，主力广告未动。复盘 9/29，台账 `2026-09-26-nal-messenger-15s-retest`。

**待办（未做）**：① 对「单条广告昨天有花费、今天整天零花费」加告警（进今日待办）；② 抓取按账户时区切日（已有别的窗口在修）。

### D14 · 另写脚本绕开视频工厂直接生产+发布，配方对账、分镜自检、事实溯源三道闸一起被跳过 🔴

**事故（2026-09-28，East Inter 客户 Facebook 主页）**：负责 East Inter 出海落地的窗口（session `e12e5606`）没有走
`src/lib/factory/` 这条正规视频工厂流程，而是另写了一个临时脚本（`scratchpad/make-eastinter-reels.mjs`），
直接调 Muapi `pixverse-v5.5-i2v`（图生视频，9:16，5 秒）生成视频，再直接调 Facebook `/videos` 接口把成片排期发布，
**全程没有经过苏东坡、没有查 `viral_reference_library`、没有出配方对账表、没有出分镜自检表**。台账卡
`docs/ledger/2026-09-28-eastinter-reels-sep29-oct5.md` 把这写成「已完成，内容没问题」——自己既是生产方又是唯一的
质检方，没有任何独立的第二道眼睛。

两条视频已经**真实发布**在客户 Facebook 主页上（视频 ID `1568811918260114`、`4441898549410086`），PM 亲自点开看才
发现：

- **完全没有声音**：`pixverse-v5.5-i2v` 这个图生视频模型本身不生成音轨，而这条临时流水线里压根没有加配音/BGM 这一步——
  不是漏检，是流程设计上就没有这一步。正规工厂流程（苏东坡手册 §五「竖版安全区 / 字幕 / BGM 分段」）默认会处理这一段。
- **文案里的数字是编的**：「海运 $0.28/kg」「35 天」「4 步流程」，查了 East Inter 的客户资料（诊断报告、官网、Figma 设计稿）
  逐字搜索，一处都没有——不是记错来源，是这几个数字凭空出现，直接违反 CLAUDE.md §8「对外内容必先 grounding 官网」。

**为什么配方对账和分镜自检这两道闸完全没触发**：这两道闸目前只写在 CLAUDE.md 和苏东坡手册里，**没有任何技术手段挡住
「另开一个脚本、直接调生成 API + 发布 API」这条路**——`src/lib/factory/` 之外没有守卫，任何窗口都可以像这次一样绕过去，
而且绕过之后不会报错、不会留任何「跳过了审查」的痕迹，只会在台账卡里写「已完成、没问题」，跟真正走过闸的产出长得一模一样。

**教训**：
- **凡是我们管理账户下要发布的视频，一律只能走视频工厂流程**（PM 2026-09-28 拍板，见 CLAUDE.md §8）。任何窗口都不许
  另写脚本直接调生成 API（Muapi / WaveSpeed / Seedance 等）+ 平台发布 API 绕过工厂。
- **窗口自己写「已完成、没问题」不算数**，尤其是内容发布这种事——生产方和质检方必须是两个不同的角色（工厂产出 → 苏东坡 /
  马良审 → PM 授权发布），自检自过等于没审。
- **文字规则挡不住另开脚本这种绕法**，必须有技术手段（例如统一收口发布凭证、或对直接调用生成/发布 API 的代码路径做静态检查）
  才能真正拦住，这次先把规矩写死，技术闸作为后续事项跟进（见 `docs/ledger/2026-09-29-video-factory-only-rule.md`）。

**处置**：已发布的两条视频要不要撤下，2026-09-29 已问 PM，等 PM 回复；East Inter 窗口自查根因与实际发布状态另行同步，结果出来后补进本条。

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

### F10 · `step.run` 里用 `setTimeout` 轮询 = 服务器函数超时静默挂掉

**症状**（2026-09-21，NM Medspa Reel 全尺寸渲染）：Inngest 工作流触发、批准都成功，
但 5 条 1080×1920 视频一直 0/5，`client_assets` 始终空，`cron_run_logs` 没有"已完成"记录。
`retries: 0`，Inngest 不重试，整个工作流静默死亡。

**根因**：`poll-full-renders` 步骤在 `step.run(...)` 回调里用 `setTimeout` 逐条轮询
（每条最多 30 次 × 20 秒 = 10 分钟），5 条合计最多 50 分钟。
Render.com 的 HTTP 请求有超时上限（通常 3~5 分钟），
函数被服务器强杀 → 步骤失败 → 因 `retries: 0` 工作流终止。
`cron_run_logs` 的"完成"记录只有步骤跑完后才写，所以什么日志都没有。

**`setTimeout` 在 Inngest `step.run` 里是错误的**：`step.run` 期望每次执行几秒内完成。
分钟级等待必须用 `step.sleep`——它会暂停工作流、交还控制权、由 Inngest 在指定时间重新唤起，
服务器函数每次只跑几十毫秒。

**还有一个副作用**：轮询脚本如果没按触发时间戳过滤 `cron_run_logs`（或过滤条件失效），
就会把旧批次的日志误当"新小样完成"，在新工作流还没到 `waitForEvent` 前就发批准事件，
导致批准丢失、工作流永远等待。脚本必须按触发时间戳过滤，只认比触发时间新的记录。

**怎么防**：
- Inngest 步骤里**禁止 `setTimeout` + 循环**做分钟级轮询；
- 轮询改成 `step.run(check) + step.sleep('30s')`，每次只检查一次状态；
- 触发脚本轮询日志时，必须用触发时间戳过滤，不能直接数条数；
- 相关函数加注释标明「此处用 step.sleep，不是 setTimeout，原因见 PITFALLS F10」。

**第二实例（2026-09-22，`conversion-daily-pipeline` 成交回传每日流水线）——不是 setTimeout，
是一个 step 逐行处理整张大表**：`sync-cts` 一步读 CTS CRM 表格 ~600 行、每行 3–5 次数据库往返
（查联系人、查价、写入、撞唯一索引），实测跑 4–24 分钟 → 被网关 ~125 秒（F8）强杀 → `retries: 0`
→ 工作流静默死。9/16 起连续 6 天 `cron_run_logs` 全部停在 `running`、`finished_at` 为空，
后面的 AI 审核步一次都没跑到，49 条待审核记录 `ai_review_attempts=0`——而且**没有任何报警**，
因为完成记录只在最后一步写、又没配 `onFailure`。

同类判据：只要一个 `step.run` 里有「对 N 行逐行做 I/O」的循环，N 又不受你控制（表格、对话列表、
待审核队列），它就会在某一天超过 125 秒。修法（PR 见 CHANGELOG 2026-09-22）：
- 每个 step 只处理一小块（20 行 / 25 个对话 / 5 条 AI 判断），块之间用 step 返回值传游标
  （只放 number/string，能过 JSON；**PII 不进 step 返回值**——Inngest 会把它存到云端）；
- 逐行的「已同步」判断改成一次预查幂等键集合，历史行不再逐行往返；
- 函数级 `onFailure` 把停在 `running` 的运行记录收成 `failed`（`failOpenCronRuns`）；
- 编排函数 `retries: 2`（只重跑挂掉的那一步），不要抄 worker 的 0；
- 单步目标 ≤ 60 秒、硬上限 125 秒，块耗时记进 summary 上线后看真实分布。

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

### F11 · 改授权的权限清单（`*_SCOPES`），会让已经连好的客户在下次续期时**静默断掉** 🔴

**真实事故（2026-09-15 埋，2026-09-24 才被发现，断了 9 天）**：给
`MICROSOFT_MAIL_SCOPES` 加了一项 `Mail.ReadWrite` 做邮件回复功能。微软刷新令牌时
**会重放整份 scope 清单**，而刷新换不来一个客户从没同意过的新权限 ——
`AADSTS65001` 直接拒掉，CTS 的 `info@` 和 `bdm@` 两个邮箱当场被标成 error。
`mailbox-sync` 只捞 `status = active` 的连接，于是这两个邮箱**安静地从循环里消失**，
每小时的任务照样报成功、`processed` 从 3 变成 1 也没人看。客人发来的询价 9 天没进
客户管理系统。

**最致命的一点**：那次改动的提交说明里白纸黑字写了「Existing connections (currently
only CTS) will need to reconnect」—— **然后就没有然后了**。没进今日待办、没有监控、
没人重连。写在提交说明里不算下发（铁律 3 下半句：发现不许死在日志里，也不许死在
提交说明里）。

**两家平台后果不一样，别一概而论**：

| | 刷新时带 scope 吗 | 改清单的后果 |
|---|---|---|
| 微软（`MICROSOFT_MAIL_SCOPES`） | **带** | 已有连接下次续期**直接死** |
| 谷歌（`COMBINED_GOOGLE_SCOPES`） | **不带**（见 `token-manager.ts::refreshGoogleToken`） | 连接不死，但老令牌里没有新权限，用到它的功能被判 403 |

**怎么防**：改任何 `*_SCOPES` 常量的 PR，必须在**同一个 PR 内**带上三件事 ——

1. 受影响客户的**重连待办**（进今日待办「🙋 需要你动手」，带 what / how / href 三件套）；
2. **断线监控**：这个平台在 `src/lib/platform-oauth/connection-health.ts` 的
   `HEARTBEAT_POLICY` 里要有心跳节奏，没有的话写清为什么；
3. **「多久没新数据就报警」的判据**：就是上面那个 `staleHours`。

`src/lib/platform-oauth/__tests__/scope-change-gate.test.ts` 把仓库里**全部** 6 份
scope 清单钉死了，并且会扫一遍 `src/` 确认没有漏网的新常量 —— 一改就会失败，
失败信息把上面这三件事摆到改动者眼前。**这个测试挂了不是 bug，是提醒。**

另有一道更接近根因的闸：`token-manager.test.ts` 钉住了「谷歌刷新请求里不许带 scope、
微软刷新请求里必须带」。谁哪天觉得「两边写法统一一下更规范」，就会原样复制一次这场
事故 —— 钉清单挡不住这个，钉行为可以。

---

### F12 · 判断一条外部授权「还连着没有」，只看状态位一定会漏 🔴

**2026-09-24 实测**：CTS 的 `info@` 被重新走了一次授权之后，
`platform_oauth_connections.status` 变回了 `active`、`error_message` 却还挂着 9 天前
那条 `AADSTS65001`，`last_synced_at` 也还停在断线那天。**只看状态位会判它健康，
只看报错字段会判一条健康连接有病 —— 两个字段单独都不可信。**

同一时刻还躺着两条从 2026-09-06 就 `error` 的 Meta 连接（Roman HU、NZCPE），
18 天没有任何一处会把它们端到人眼前。

**判据要看三样，缺一不可**：

1. 状态位不是 `active` → 明确断了；
2. 状态位是绿的，但**最近一次真的跟对方通上话**（`last_synced_at`，由
   `token-manager` 每次成功刷新令牌时盖）超过这个平台一个周期以上没动 → 心跳停了；
3. 跟**同一个平台其它连接**比一次：别人今天都通上了 → 是这一条的授权问题；
   全部一起停 → 是我们这边的取数任务停了，让 PM 去重连一百次也不会好。

⚠️ `last_synced_at` **不是每个平台都算心跳**。Meta / TikTok 在 `token-manager` 里
根本没有刷新实现，这个字段只在授权那一刻盖过一次 —— 拿它判新鲜度会天天误报。
每个平台算不算、多久算停、刷令牌的任务一次碰几条连接，一律在 `HEARTBEAT_POLICY`
里逐个表态（有 CI 守卫盯着，新增平台漏填会挂）。

**四个「看起来像故障、其实不是」的坑，判据里都得绕开**（两位复审 2026-09-24 当场抓出，
每一条都有活的实例）：

1. **`revoked` 是人主动点的断开，不是故障。** 设置页上四条断开路由、谷歌换账号、
   Meta 只读试点退出，写的都是这个值。当故障报 = 每天叫 PM 撤销他自己的决定，
   而待办每天从零重算、没有消除机制，他做什么都消不掉。
2. **同一个客户的两条连接一起停，不等于「整条通道停了」。** 按连接条数算的话，
   CTS 那次（一次 scope 改动同时弄死 `info@` 和 `bdm@`）会被判成取数任务的问题、
   踢进 dev 栏 —— 这件只有邮箱本人能做的事就从 PM 的清单上消失了。判据要按
   **不同客户数**算。
3. **有授权 ≠ 在取数名单里。** 谷歌那条每日任务的客户名单取自 `client_connectors`
   （要 `connected` 且填了网址 / 数据编号），不是连接表。实测 NAL 的搜索数据连接
   授权是活的、`client_connectors` 还是 `partial` —— 令牌永远不会被刷，心跳永远
   不动。按「断线」报就是每天派一件重连也没用的活。
4. **能自动续期的平台，令牌过期是常态。** 2026-09-24 实测 7 条谷歌连接全部处于
   「已过期待刷新」状态，全都健康。反过来，Meta / TikTok 用的是长期令牌、没有
   续期实现，**到期就是真的死了而状态位不会变** —— 那是这两个平台唯一的硬信号。

另外：**没有自助重连按钮的平台，不许进 PM 的动手栏**（实测设置页里没有 Facebook /
TikTok / GTM 面板，Facebook 的入口在客户页设置抽屉 `?settings=platform`）。给 PM
一件产品里根本没有按钮的活，比不报还糟。

---

---

## G. 协作 / Agent

### G1 · 「我自己审过了」不算 2 审

A 级合并只认两方签字：**Codex Astra** 审查，**Claude Code** 独立复核。子牙、魏征、狄仁杰只抽查 B 级，缺席不挡 B/C 合并。面向客户页面，板桥仍可从非技术角度看，这一眼不进合并闸。
「我自己审过了」不算对方那一签。

### G2 · Codex 会虚报

**事故**：Codex 声称修复完成，仓库里根本没有那个 commit。

**怎么防**：A 级在合并前要有 Codex Astra 的审查和 Claude Code 的独立复核，两签都绑当前改动。子牙不再是合并前的必签人。独立复核重点查
① commit 真实存在 ② 测试数量对得上 ③ **变异测试**（故意改坏校验逻辑，看对应测试会不会 fail，防空架子测试）
④ 边界覆盖（Codex 容易只写 happy path）⑤ 架构旁路（校验必须在最里层，确认没有 API 绕过）。

### G3 · PM 反问 ≠ 删除指令

看到 PM 问「这个还需要吗？」不要直接动手删。先读意图，再确认，最后才动手。
见 `~/.claude/rules/coding-style.md`「删除代码前的强制流程」。

### G4 · 一个分支同一时间只允许一个窗口开

并行任务用 `git worktree` 物理隔离。接力同一大任务用同一分支，全新任务基于最新 main 开新分支。

**实测撞过一次（2026-09-15，PR #1693 `feat/knowledge-rollout-stage-gate`）**：一个窗口在修这条分支跟主线的冲突，两轮复审跑到一半，分支远端又被另一个没有登记窗口契约的会话推了新提交上去（新增两个路由 + 一处竞态修复），复审中途拉代码发现分支比开审时又长了一截。这次运气好——两边改动没有互相覆盖，最终复审重新跑通过了；但这属于事后才发现，本该在动手前查一次分支是否已有人在改（`git log origin/<branch> --oneline` 对一下时间线），而不是审完才意外碰上。
