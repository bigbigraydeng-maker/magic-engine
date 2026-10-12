# 平台总控（77 号）：Social S0 实施映射 + 迁移账本 v0 + 节奏方案

日期：2026-10-12（NZ）｜写入者：77 号窗口（只读调查 + 文档，没有改任何应用代码）｜风险级别：C（纯文档）
权威任务说明：`ME_Agent自动化开发说明_2026-10-12.md`（Social 第一优先，首期 Facebook 自然 Reel，FDE 先交付）
平台层级门（Inline）：Social 属既有六支柱之一，本文不新增能力线、不新增支柱；迁移账本是治理文档，不进共享运行代码；无需登记候选。
资源排序（CLAUDE.md §4 / 质量闸 §11）：Social 发布交付链——频率高 / IMPACT 关键度高（卡在 Act）/ 收入关联高 → 零个低、三个高 → **P0**。迁移执行（搬家）——频率低（一次性）/ 闭环关键度低（搬家不改变闭环）/ 收入关联待验证 → 两个以上低 → **P3**；所以本文对迁移只做「账本 + 防重复造 + 可迁移边界」，不做大搬家。

---

## 0. 三句话结论

1. **社媒这条线现在有两个已查实的真问题**：①CTS 第三版 Reel（10-11 真发布）没有登记 72 小时效果测量，最晚 10-14 要补，否则这条真发布永远没有“效果”可看；②旧发布入口里还留着「账号找不到就拿第一个」「发完写库不检查报错」「账号由页面传入不核对归属」这几类洞，目前没人受害（没有任何客户配了 Publer），但代码是活的。
2. **“新版 Magic Engine”不是协作库，而是 `magic-engine-dev/magic-engine-platform`**（Python 重写，俊东一个人写，仓库 2026-09-07 建，我只拉了最近 40 条提交（全部是他，最新 2026-10-11），仍在更新）。它已经有真实的 Facebook/Instagram 图文与 Reel 发布、Meta 广告动作、CRM、内容工厂（文案级）、IMPACT 六阶段骨架；**没有**视频成片工厂、首评、Social 的效果→下一轮闭环、VoIPLine，也没有从旧库搬数据的脚本。我们之前的记忆里写“组织下只有协作库一个仓库”，已过期。
3. **节奏建议：线 1（当前 ME 交付客户）占 80% 精力，线 2（迁移）只做账本、防重复造和契约边界**；同时在制品上限 3 个切片，每周一复盘；任何要写进共享代码的新东西，先过“俊东新版里有没有 / 能不能做成可迁移的插件边界”两问。

---

## 1. 基线与证据口径

| 项 | 值 |
|---|---|
| 工作目录 | `/Users/raydeng/Projects/magic-engine/.claude/worktrees/practical-elion-aba712`（干净，分支 `claude/interesting-khorana-5d2c0d`） |
| HEAD / origin/main | 都是 `8f16acaf1be0ba850ae8182f618dc718f5866144`，`git rev-list --left-right --count HEAD...origin/main` = `0 0` |
| 远端刷新 | 本窗口开工时 `git fetch origin main` 成功（2026-10-12 NZ 约 02:00，主机时钟 2026-10-11 12:56 UTC）；与任务说明审计基线同一个 SHA，说明审计后 main 没有前进 |
| 主工作区 | `/Users/raydeng/Projects/magic-engine` 当前在分支 `codex/ads-o1-budget-release`、HEAD `d79c03ed4`，有大量别人的未提交改动（登录、MTC、middleware 等）与未跟踪的 `social-growth-onboarding`。**我没有碰**，只读了它的路由头部。`git ls-files` 在 main 里 `social-growth-onboarding` 相关文件 = 0 个 → 它不是 main 的功能。 |
| 生产库读取 | 只发 GET（`clients` / `content_work_orders` / `flywheel_actions` / `social_post_measurement_receipts` / `platform_oauth_connections` / `client_connectors` / `content_posts` / `reels_drafts`），沿用 PM 的只读调查授权；钥匙只在单条命令内读进环境变量，没打印、没落盘；**没有读任何 token 值** |
| 新版仓库读取 | `gh api` 的 GET；文件下载到会话临时目录用于阅读，**没有写进本仓库，也没有向协作库推送任何东西** |
| 没做的事 | 没跑 `npm test` / `type-check` / `build`（纯文档任务，记“未运行：文档变更”）；没读 Render 的环境变量值；没看 Inngest 控制台的运行记录；没验证新版的线上服务（只读代码与提交） |

读了哪份手册：`playbook-social-general`（§八 Reel 格式与首评、§十 指标分档、§十三 主页发布令牌）。其中“权限与指标支持”只当线索，下面的账号能力表全部来自生产实查。

---

## 2. Part A：Social S0 实施映射

### 2.1 一眼看懂的现状（先结论）

| 问题 | 结论 | 证据 |
|---|---|---|
| CTS 的 Reel 发布链能不能用 | **能**：工厂出片 → 人审 → 定时任务每 10 分钟领单 → 原生 Facebook Reel 上传（先草稿）→ 回执 → 首评 | 生产库 8 条 `published` 工单，其中真公开（`video_state=PUBLISHED`）只有 2 条：9-06 一条、10-11 的 `fa4fdd89`（带首评）；另外 3 条是草稿态也被标成 `published`（见 §2.3） |
| 发布后有没有自动测效果 | **只对 9-06 那条跑通过**；10-11 这条真发布没有登记 | 生产 `flywheel_actions`：`social.publish_post` 只有 3 行（9-06 两行、5-31 一行），没有 `fa4fdd89` 对应行；`social_post_measurement_receipts` 只有 4 行，都是 9-06 那条的 T+4/T+72，状态 `partial`（有点赞/评论，没有播放/触达） |
| 为什么没登记（高度可能，未见 Inngest 运行记录） | `fa4fdd89` 的发布动作行还是 10-10 草稿时写的：`video_state=DRAFT`、`published_at` 是 10-10；10-11 转正的事件带的是 `PUBLISHED` 和 10-11 的时间。测量接线器的“二次核对”要求动作行必须是 `PUBLISHED` 且时间一致，不一致就静默返回 `not_published` | `src/lib/inngest/functions/factory-reel-measurement-adapter.ts:80-100`；事件 id `01M4MNMG…` 已在工单 `published_ref.event_ids`（事件发出了），但没有对应登记 |
| 严格账号绑定 | **半成品**：Daily Plan 自动发布（严格对照客户登记的主页）与工厂 Reel（用客户配置的主页 + 品牌名核对）做得对；旧 Publer 入口有 4 处不严 | §2.2 清单 |
| 外部成功但本地写库失败怎么办 | 旧代码有的只打日志，**全仓没有 `needs_reconciliation` 这个状态**（grep 为 0）；Daily Plan 路径会抛错并用比较再写（CAS），工厂工作器大部分写库不检查 error | §2.2 |
| Reel 的 Tune（下一轮计划吃上一轮结果） | **不存在**：现有 Tune 的比较组硬限 `source=daily_plan` 且要求 `campaign_id`；全仓没有任何地方记录“下一份计划采纳了哪条建议”（grep `source_action_ids`/采纳 = 0） | `social-post-cohort.ts:13-14,80-82`；Issue #1413 的 Gate B/4 注明 A 级待单独授权，评论里至今没有这项授权 |

### 2.2 全部发布入口清单（谁能把东西发出去）

“账号归属”= 发到哪个主页/账号是否由服务端按客户绑定决定；“回执检查”= 写库后是否检查 error。

| # | 入口（文件） | 谁在用 | 账号归属 | 回执写库检查 | 备注 / 要改什么 |
|---|---|---|---|---|---|
| 1 | 工厂 Reel 工作器 `src/lib/factory/publish/publish-worker.ts`（定时任务 `/api/cron/factory-publish-worker`，每 10 分钟） | CTS 等 5 个配置了 `publish_target` 的客户（CTS / NM Medspa / Oztop / East International / Magic Lab Class） | ✅ 主页来自客户配置，令牌按“客户+主页”取；多一道品牌名核对 | ❌ 领单更新、`onStarted` 草稿凭证、`recordPublished` 主更新、`markFailed` 全都**没检查 error**；注释里写“硬事务”但代码不是 | S1：全部检查 error；主更新失败要进入“需对账”而不是静默；已有的中断恢复（找回已上传的 video_id）保留。默认**草稿模式**，要环境变量 `FACTORY_PUBLISH_LIVE=true` 才公开发布——线上这个值我没读到（未确认） |
| 2 | 讲课片发布 `src/lib/factory/lecture-publish.ts`（搭在同一个定时任务上） | 内部讲课片 | ✅ 同 #1 | 部分（`recordPublished` 另有实现，未逐行核） | 本轮不动 |
| 3 | Instagram 交叉发布 `src/lib/factory/publish/instagram-crosspost.ts`（经 Publer） | 需要 Publer 账号的客户 | ✅ 严格：按 `publer_account_id` 查账号 + provider 必须是 instagram + 品牌名核对 | ✅ 先领单（比较再写）、每步留机器回执 | **0 个客户配了 Publer 连接**，所以 CTS 现在发不了 Instagram（能力表见 §2.5） |
| 4 | Daily Plan 自动/手动发布 `src/lib/campaign/daily-plan-publish-runner.ts` + `…-effects.ts` | Facebook 图文帖 | ✅ 严格：请求里的主页必须等于客户登记主页，否则 `PAGE_ID_MISMATCH` | ✅ `persistReceipt` 检查 error 并用比较再写；外部成功后本地写失败有“补记/回放”路径 | 只管图文，不是 Reel；这条是**参照样板** |
| 5 | `POST /api/publer/create-post`（`src/app/api/publer/create-post/route.ts`） | 内容页（付费档登录） | ✅ 严格：绑定账号必须存在、仍有效、provider 匹配，三道都失败才拒绝 | ❌ 排期成功后更新 `content_posts` **没检查 error**；失败时帖子还是 approved，别人再点一次就是重复发 | S1：检查 error，失败返回“已发出需对账” |
| 6 | `POST /api/clients/[id]/content-posts/[postId]/publish` → `scheduleSocialPost`（`src/lib/flywheel/social-post-publish.ts`） | 内容页老入口 | ❌ **仍有 `accounts[0]` 回退**：行 168 直接取工作区第一个账号；行 181 平台不匹配时也回退第一个 | 部分：函数内检查并返回 `dbSyncError`，但**路由把它丢了**，对外仍返回 success | S1：删掉两处回退；路由把 `dbSyncError` 变成 `needs_reconciliation` 警告透传 |
| 7 | `POST /api/publer/schedule`（`src/app/api/publer/schedule/route.ts`，页面 `dashboard/visuals`） | 素材页手动排期 | ❌ 账号 id 由页面传入，只检查“Publer 工作区里有这个账号”，**不核对属于素材所属客户** | ❌ 一条回执都不写（没有 `content_posts` 更新、没有动作记录） | S1：账号必须是该客户绑定的账号；写回执 |
| 8 | `POST /api/clients/[id]/reels/[draftId]/publish`（`ReelsStudio.tsx`） | 老的 Reel 草稿工具（最近一次草稿 9-29，客户 East International） | ❌ 同 #7：`account_id` 由页面传入，不核对归属；也没有价格闸 | ❌ 不写回执，草稿状态也不更新，**这条绕过了视频工厂**（违反 CLAUDE.md §8“对外视频一律走工厂”） | S1：建议直接下线或改为只生成草稿；PM 定 |
| 9 | `src/lib/linkedin-progress/run.ts`、`content-factory/[postId]/route.ts` | LinkedIn 进展帖 | ✅ 先走 `resolveBoundPublerAccount` 严格解析再把账号传进去 | 同 #6 的函数 | 不动 |
| 10 | 评论/私信回复：`comment-autoreply-engine`、`messenger/send`、`comment-engagements` 等 | 受治理的自动回复 | 未逐行核 | 未核 | 属任务说明里“沿用已有受治理入口”，本轮不改，列入 S1 时只核对不改 |
| 11 | 未被任何地方引用的 `src/lib/social/facebook-publisher.ts`、`xiaohongshu-publisher.ts` | — | — | — | 无调用方；建议后续清理，防止被人误用 |

生产事实：**没有任何客户配置 Publer 连接**（`client_connectors` anchor=publer：0 行），`content_posts` 里没有任何一条带 Publer 编号的帖子。所以 #5–#8 目前没有造成伤害，S1 属于“关门”而不是“救火”，但它们是活代码，任何人给任何客户配上 Publer 的那一刻就会暴露。

### 2.3 测量消费者核验（任务说明要求“先核实消费者、部署和真实回执”）

| 环节 | 实际情况 | 证据 |
|---|---|---|
| 发布事件发出 | 工作器只对 `video_state=PUBLISHED` 的 Reel 发 `me/factory.reel.published`；草稿不发；补发扫描 `reconcileMissingReelEvents` 每轮跑 | `publish-worker.ts:409-470` |
| 接线器已注册 | 在 `src/lib/inngest/functions/index.ts` 注册；Issue #1413 Gate A 记录 2026-09-07 已做 Inngest 同步与一次受控回放 | #1413 评论 |
| 生产里真跑过吗 | **跑过一次**（9-06 那条 Reel，登记 + T+4/T+72 两张回执，状态 partial） | 生产 `social_post_measurement_receipts` 4 行 |
| 之后的 Reel | 9-06 之后 `status=published` 的最近 4 条工单（`7ed7645b`、`fa4fdd89`、`e8c5b66a`、`9fcb4ae6`）里，3 条是 `video_state=DRAFT`（事件本来就不该发，正确）；**唯一一条真公开的 10-11 `fa4fdd89` 事件已发出但没有登记** | 工单 `published_ref`：`event_ids` 有值；`flywheel_actions` 无对应 `social.publish_post` |
| 指标缺口 | 只有点赞/评论（`partial`），没有播放/触达/观看时长：CTS 的 Meta 页面授权里有 `pages_read_engagement`、`pages_manage_posts`，**没有洞察类权限** | `platform_oauth_connections`（只看了 scopes 与状态） |
| Issue #1413 授权记录 | Gate A：PM 2026-09-06 明确“授权 Gate A”（评论可查），已验收；Gate B 步骤 1–3（evaluator、cohort 读取、接口与徽章）已合并；**Gate B/4（保存计划时记录采纳/拒绝与 source action ids，A 级、动 Kernel）评论里写明“待独立 PR + 单独授权”，至今没有授权记录** | `gh issue view 1413`（7 条评论） |

**时间窗**：`fa4fdd89` 的真实上线时间是 2026-10-11T04:35Z，T+72 对应 2026-10-14T04:35Z（NZ 10-14 17:35）。到点前把登记补上才能按窗口取数；过了点还可以补，但窗口口径要如实写成“迟到取数”。

### 2.4 六个阶段的复用 / 缺口 / 文件 / 风险 / 验收 / 恢复

> 约定：风险级别按 `ENGINEERING_QUALITY_GATES`——发布、隔离、Kernel、迁移、不可逆副作用 = A；普通业务逻辑 = B；界面文案 = C。

**Inspect（客户目标、官网事实、素材来源、账号、上一轮结果）**
- 复用：`master_briefs`（CTS 有 1 份）、`clients.factory_config.verified_cta`（链接/电话/价格/出发日）、`brand_redline_phrases`、`creative_recipe`；官网事实核对沿用 `price-claim-gate`；工单顶层 `goal_id` + `brief.attribution.expected_metric`（有真目标，不用编）。
- 缺接点：①Reel 的“计划”入口是 `factory-order-scheduler`（每天 20:00 UTC，按客户开关 `auto_order_enabled` 下单），与 Daily Plan 是**两个入口**，需要明确 Reel 以哪个为准，避免两个入口各产一轮；②官网事实的“新鲜度/版本”没有进批准版本里；③上一轮结果（Outcome）没有读取点。
- 文件（预计）：`src/lib/factory/order-scheduler.ts`、`src/lib/factory/evaluate.ts`（只读核对为主）。风险 B。验收：给定客户能输出“目标 / 市场语言 / 素材来源 / 绑定账号 / 上轮结果 / 缺什么”一页，缺项形成待办。恢复：只读，无副作用。

**Measure（指标、基线、比较组、窗口、成本上限）**
- 复用：T+4/T+72 窗口、`social_post_measurement_receipts` 与 `record_post_measurement_snapshot`（生产已就位）、每单封顶 $2/每客户每天最多 3 单的成本护栏。
- 缺接点：发布前的“成功标准”没有落地对象；比较组（客户 + 主页 + 自然/付费 + 格式 + 目标 + 窗口）没有定义；播放/触达缺洞察授权。
- 文件：新增“Reel 测量定义”契约，落在 `src/lib/factory/` 与 `src/lib/flywheel/tune/` 边界（B 级）；授权补充（`read_insights` 类）涉及 Meta 授权，需要客户/PM 操作，另立待办。验收：每张工单在发布前就带有“预期指标 + 窗口 + 样本门槛”。恢复：纯读。

**Prescribe（版本化计划与工单输入）**
- 复用：`strategist`/`decideSignal` 闸门（余额、日单量、红线、去重）、Daily Plan 的版本字段。
- 缺接点：工单没有“计划版本 + 来源动作 id + 知识版本 + 采纳理由”；`brief` 里没有 Reel 的受众/钩子/核心事实/素材/CTA/目的结构化字段对账。
- 文件：`src/lib/factory/types.ts`、`order-scheduler.ts`、新增采纳记录表（**迁移 → A 级**）。验收：每条工单能追到“因为哪条结果而做/不做”。恢复：不改变既有工单，只加字段，可忽略。

**Act（成片 → 独立审核 → 授权 → 发布 → 上线核验）**
- 复用：工厂（配方对账、成片自检、`quality_checklist_auto`、`review_ref.checklist_human`）、发布工作器（原子领取、先草稿、品牌名核对、中断后用 `video_id` 找回、首评补偿 `ensureFirstComment`）。
- 缺接点：①**审核通过 = 发布授权**：现在工单状态 `approved` 就会被定时任务发出，授权没有绑定“账号 + 内容版本 + 有效期”，也没有撤销；CTS 样例里 `review_ref.approved_by` 是 Ray 本人，没有“独立审核人”记录；②`FACTORY_PUBLISH_LIVE` 是全局开关，不是按客户/按条授权；③写库不检查 error（§2.2 #1）；④“上线核验”只取一次 permalink，没有按平台回读确认“真公开”。
- 文件：`publish-worker.ts`、`facebook-reel-adapter.ts`、`src/lib/factory/publish/publish-display.ts`、工单授权字段（迁移）。风险 **A**（发布 + 授权）。验收：错客户/错主页不能发；外部成功本地失败能找回且不重发；重复事件只产生一次外部动作；审核通过后没有授权记录不发。恢复：工作器已有“中断后不盲目重发”的分支，S1 要把“未知结果”显式落成可查询状态。

**Check（到期读取、可比 Outcome）**
- 复用：Reel 发布事件 → 接线器 → `daily_plan.post.measure_due` → 测量消费者（生产跑通过一次）。
- 缺接点：①§2.3 的登记缺口（草稿转正后动作行不更新）；②只有互动指标；③没有“权限不足/对象被删/样本不足”的 Reel 专用状态呈现；④没有遗漏对账（谁来发现“发了但没登记”）。
- 文件：`factory-reel-measurement-adapter.ts`（`rebindFactoryReelAction`）、`publish-worker.ts`（转正时更新动作行）。风险：代码 B；**生产补发事件是生产写入，需 PM 点头**。验收：10-14 前 `fa4fdd89` 有 `social.publish_post` + 两个窗口的真实回执（哪怕 partial）；之后任何草稿转正都自动登记。恢复：测量事件按 `idempotency_key` 幂等，重放不重复。

**Tune（下一轮采用结果）**
- 复用：Issue #1413 已合并的 evaluator / cohort / 接口 / 徽章（只覆盖 Daily Plan）。
- 缺接点：Reel 比较组、采纳记录、下一份计划的读取与“采纳/拒绝原因”落库——正是 Gate B/4（A 级）。
- 文件：`src/lib/flywheel/tune/*`、`order-scheduler.ts`、采纳表迁移。风险 **A**。验收：A 轮真实结果改变 B 轮工单，并能指出证据、改动变量、采纳理由。恢复：采纳记录只追加，不覆盖。**不得拿本轮 Social 优先当作 Gate B/4 授权**（任务说明第 308 行已明确）。

### 2.5 账号能力表（CTS Facebook 主页，生产实查）

| 能力 | 状态 | 依据 |
|---|---|---|
| 读 | ✅ 可读主页与 Reel 列表、评论 | `platform_oauth_connections` 主页连接 `active`，最近同步 10-08，令牌到期 2026-12-07；权限含 `pages_read_engagement` |
| 制作 | ✅ 工厂出片已多条；`creative_recipe`、品牌红线（3 条）、`verified_cta` 已配 | `clients.factory_config` |
| 审核 | ⚠️ 有人审清单与自动清单；样例批准人是 Ray 本人，**没有独立审核人记录** | 工单 `review_ref` |
| 受控发布 | ⚠️ 能力在（`pages_manage_posts`），但“批准即可发”；授权不绑定版本/账号/有效期 | `publish-worker.ts`；环境变量 `FACTORY_PUBLISH_LIVE` 值未读到 |
| 回读 | ⚠️ 找回已存在的 Reel、取 permalink、首评写入有；没有“确认真公开”的独立读取 | `facebook-reel-adapter.ts` |
| 指标 | ⚠️ 只有点赞/评论（偶有分享）；播放/触达/观看时长缺：无洞察类授权 | 回执 `partial`；授权 scopes |
| Instagram | ❌ CTS 没有 Publer 连接，交叉发布不可用；原生 IG 发布在旧版也没有 | `client_connectors` publer = 0 |
| 广告授权 | 独立：Meta Ads 已连接、广告读授权 `active`（本轮不涉及） | 同表 |

### 2.6 首个试点（CTS 候选）缺什么

已具备：主页连接有效、`publish_target`、品牌与红线、`verified_cta`、已有真实发布与回执、工单带真实 Goal。
缺：①测量登记（§2.3，**时间敏感**）；②发布授权对象（审核通过之外的、绑定版本的授权）；③洞察类权限（决定能不能承诺“播放/触达”）；④独立审核人的记录；⑤`FACTORY_PUBLISH_LIVE` 的线上取值核实（只读核对 Render，PM 或统筹确认）；⑥Reel 的“计划入口”以谁为准的决定。
第二个客户的就绪度（只看有无 `publish_target`）：NM Medspa、Oztop、East International、Magic Lab Class 都有；East International 有 9-29 的老 Reel 草稿工具产物，而那个工具的发布入口就是 #8，选它做第二客户前要先清掉这条旁路。

### 2.7 建议切片、写入者与文件边界（交统筹开卡，见 §5）

| 切片 | 内容 | 风险 | 写入者 | 主要文件 |
|---|---|---|---|---|
| S3a（最急） | 草稿转正后动作行同步 + 接线器二次核对修复 + 对 `fa4fdd89` 补一次登记 | 代码 B；补发 = 生产写入需 PM 点头 | 派工单 80，DeepSeek 写、我审 | `factory-reel-measurement-adapter.ts`、`publish-worker.ts`、对应测试 |
| S1a | 旧 Publer 入口关门：删 `accounts[0]` 回退、`schedule`/`reels publish` 账号归属校验与回执、`create-post` 与 `scheduleSocialPost` 检查 error 并透传“需对账” | A（隔离） | 派工单 81，DeepSeek 写、子牙+魏征+狄仁杰审 | `social-post-publish.ts`、`src/app/api/publer/*`、`reels/[draftId]/publish`、content-posts 路由 |
| S1b | 工厂工作器全部写库检查 error；未知结果落成可查询状态；重复事件只发一次 | A（发布） | 派工单 82，同上 | `publish-worker.ts`、`facebook-reel-adapter.ts` |

S1a 与 S1b 文件不重叠，可并行；S3a 与 S1b 都碰 `publish-worker.ts`，**必须串行：先 S3a 后 S1b**（同一文件只能一个写入者）。

---

## 3. Part B：迁移账本 v0

### 3.1 “新版 Magic Engine”到底在哪、做到哪

| 位置 | 是什么 | 状态 |
|---|---|---|
| `magic-engine-dev/magic-engine-platform`（私有，2026-09-07 建，最近提交 2026-10-11） | **新版 ME 2.0**：Python（FastAPI + Alembic + uv），`app/` 稳定内核，`extensions/` 插件，Extension Contract v1.1；线上 `https://me2.cloud02.top`（office rig 三容器），生产数据在悉尼 Supabase。README 写“对应架构方案 v1.4（2026-09-06）”。 | 活跃：提交者几乎只有俊东（`jundong`），近 40 条提交覆盖会员订阅/Stripe、域名与企业邮箱、网站统计、邮件订阅、广告运营动作、品牌 DNA、Instagram 直连、助手等。**Issue 和 PR 列表都是空的**（也可能没启用 Issues），提交直接进 main，没有评审痕迹。 |
| `magic-engine-dev/magic-engine-jundong-collab`（私有，最近推送 2026-09-16） | 早期的隔离协作库：旧 TS 代码的脱敏拷贝 + 协作规则（车道、冻结接口、同步规则）+ ME 2.0 计划文档 | 5 个开放 Issue、1 个开放 PR（#29 onboarding 切真实表）；车道约定里**社媒/广告属于 Ray，系统与建站属俊东**——但新版仓库实际已经把社媒/广告/CRM 也做了一版，**车道约定与现实已经不一致** |
| 记忆里“组织下只有协作库一个仓库” | 过期 | 本文同步更新记忆 |

新版里**没有的东西**（子代理逐文件核对、我抽查）：视频成片工厂与配方对账、首评、Social 的 IMPACT 阶段实现、VoIPLine、`viral_reference_library`、从旧库迁数据的脚本或数据映射文档；Plugin 契约文档自己标“冻结日期：待定”。**不知道**的：新版是否已有真实付费客户、生产库里有几个租户、与旧库的关系（DEPLOY.md 只写了“生产库是悉尼 Supabase”，且记录了一次把死快照写成生产库的事故）。

### 3.2 逐能力账本

“新版状态”只依据读到的代码与测试，**没有看到线上运行证据**（未确认的均标出）。

| 能力 | 当前 ME（旧版）状态 | 新版状态 | 可复用 | 迁移边界（必须带走的） | 先后 | 谁负责 |
|---|---|---|---|---|---|---|
| **Social 发布** | Facebook 原生 Reel 工作器 + Daily Plan 图文发布，生产在跑；旧入口有 §2.2 的洞 | 真实实现：`extensions/meta_page`（图文/多图/Reel 三段上传/定时/回读/删除）、`extensions/instagram`（单图/轮播/Reel，无定时）；测试用模拟传输，**没有真实 Meta 调用证据**；无首评、无对账表、账号绑定靠连接器归属，没有“目标必须等于客户登记主页”的额外核对 | 新版的“批准 → 发布项 → 回读 → 撤回”流程与幂等设计可借鉴；旧版的首评补偿、中断找回、品牌名核对是新版缺的 | 客户身份、批准版本、动作与 provider 编号、回执（含未知结果）、首评对象 | 先在旧版把洞补上（S1），再谈迁 | 旧版：我们；新版补首评/对账：俊东（先问他是否排期） |
| **Social 制作（工厂）** | 视频工厂完整（配方、分镜自检、审核、成本护栏） | 只有文案/图文级工厂；视频只出脚本和分镜，**没有供应商接口**（`providers()` 为空） | 新版的 `content` 资产版本与 `skills` 注册表思路 | 成片版本、素材血缘与授权、配方对账记录 | **最晚**，视频工厂不要现在搬 | 我们（旧版留着） |
| **Social Check/Tune** | 测量接线有（有 §2.3 缺口）；Tune 仅 Daily Plan | `app/impact` 六阶段编排、到期 Check 调度是真的，但**只有 `ads` 和 `hello` 插件实现了阶段**；Social 没接入；`learning` 只有模型 | 新版 IMPACT 编排器可作为 Social 阶段的目标容器 | Outcome、采纳记录、知识版本 | S3/S4 在旧版做出**契约化**的版本，再映射 | 我们定义契约，俊东提供容器 |
| **Ads** | Meta 执行保护最成熟；Google/TikTok 入口有账户归属缺口 | 真实 Meta 连接器：暂停/恢复、改预算、改定向、回读；`launch_gate` 术前核查；**没看到创建广告/创意** | 广告动作的 Kernel 化与回读可以直接参考 | 账户归属、预算与授权记录、回执 | 在旧版修 A1–A3 后再迁；新版不要重做旧版已有的诊断规则 | 旧版 74/62 号；新版俊东 |
| **SEO** | 链路广，但目标页/上线核验/监控接点有缺陷（见 SEO 评估） | 只有连接器骨架（GSC/GitHub/WordPress/Shopify 适配器），**未见 SEO 业务逻辑** | WordPress/GitHub 站点适配器 | 目标页绑定、基线、核验时间 | 靠后；73 号手册先行 | 我们 |
| **GEO** | 测量契约扎实，重测未接真实执行 | 未见（`app/metrics` 是每日快照与数据页） | — | 查询集、可比性身份、原始回答 | 靠后 | 我们 |
| **CTS 电话** | 无 VoIPLine 接入；AI 电话与员工电话是两回事 | `app/telephony` 只有判断层和推送入库（`POST /api/public/calls`），**没有 VoIPLine**；有 3CX/Yeastar/Twilio 的注释 | 新版 telephony 的入库与去重判断；CRM 的 DNC、AI 筛查 | 通话身份（账号/通话/事件）、录音、转写、员工归属、复核记录 | 在旧版按 76 号方案做；入库契约与新版 `/api/public/calls` 对齐一次 | 76 号做旧版；对齐问俊东 |
| **Plugin 装配** | 无统一描述；各模块各自注册 | Extension Contract v1.1 已有清单字段与硬约束（只 import `app.sdk`、act 必须带回读、外部副作用必须声明幂等键、失败只能升级人工）；**未冻结** | 契约字段 ≈ 任务说明第五节的最小描述 | 版本、配置 schema、连接器、权限、动作、触发器、成本/测量依赖 | 先在旧版写“插件描述”JSON（不另造框架），字段名对齐 v1.1 | 我们起草，俊东确认冻结 |
| **CRM** | 完整（客人、触点、DNC、对话事实） | `app/crm` 19 个文件、有联系人/时间线/阶段/拒联/线索/WhatsApp+Messenger 外发/AI 筛查/归因 | 两边都有，别各做各的 | 客人身份、触点、DNC | 暂不动；PM 近期还要引入 HubSpot/GoHighLevel，先别重投入 | PM 先定 CRM 主战场 |
| **Kernel** | 旧版内核建好未通电（另有 Ads 的 Kernel 动作在跑） | `app/kernel`：旧版 Kernel 的 Python 复刻（授权、网关、runner、成本上限），以旧版测试断言为准 | 双方语义要保持一致，以旧版为准 | 动作身份、运行身份、授权决定、步骤 | 谁改契约谁先公告（见 §4.3） | 契约冻结由双方共管 |

### 3.3 “别重复造”清单（俊东新版里已经有或正在做，当前 ME 不要再深做）

1. 会员订阅 / Stripe / 额度 → 新版（billing）。当前 ME 不再扩展 MTC 之外的订阅逻辑。
2. 域名托管、企业邮箱、网站统计、邮件订阅、网站客服（webchat）→ 新版已做完整一版；当前 ME 遇到这类需求，先问是否等新版。
3. 广告“运营动作”（恢复投放/日预算/改定向，人批准后执行）→ 新版；当前 ME 的 Ads 只修缺陷、不并行再造同样的动作。
4. 品牌 DNA / 企业资料 / 助手式引导 / Instagram OAuth 直连 → 新版；当前 ME 的 `social-growth-onboarding` 需要先问是否与新版 onboarding 重叠。
5. IMPACT 六阶段编排与到期调度 → 新版 `app/impact`；当前 ME 不另建通用编排器，只补 Social 自己的契约。
6. 反过来，**新版不该做、旧版别让他重做的**：视频工厂与配方对账、Reel 首评补偿、Daily Plan 规则、Meta 诊断规则——这些是旧版的积累，搬家时以旧版行为为准。

### 3.4 迁移必须保留的字段对照（旧版 → 新版现有位置）

任务说明第 310 行要求保留：客户身份、计划与批准版本、动作与 provider 编号、证据、回执、Outcome、知识版本。新版已有的承载（来自代码阅读）：

| 要保留的 | 新版承载 | 缺口 |
|---|---|---|
| 客户身份 | `tenant_id` + `customer_id`（几乎每张表） | 旧版客户 id 与新版 customer 的映射表**不存在** |
| 计划与批准版本 | `core.content_assets` / `content_asset_versions`（含内容哈希）、`core.approvals` | 旧版工单/计划版本如何落成版本行，没有规则 |
| 动作与 provider 编号 | 内核 `action_runs` / `authorization_decisions`；`core.publish_items.external_ref`、`content_publications.external_ref` | 旧版 `action_id`/`action_run_id`/`step_id` 与新版编号的关联字段需约定 |
| 证据 | `core.evidence`（`social.post`、`social.insights`） | 旧版回执与证据的类型映射 |
| 回执 | `core.receipts`、`core.activations` | “未知结果/需对账”状态新版没有对账表 |
| Outcome | `impact.outcomes` | Social 无实现 |
| 知识版本 | `core.learnings`（client/industry/global 三层，共享层禁带客户 id 是库级约束）+ `learning_promotions` | 只有模型，没有服务；旧版客户私有记忆如何入库未定 |

### 3.5 需要 PM / 俊东提供什么（我没法猜的）

- 俊东：新版现在有没有真实客户和租户；新版与旧版“谁是客户数据的主”；架构方案 v1.4 的位置；Extension Contract 冻结日期；新版 Social 是否计划做视频成片/首评/对账；新版为什么看不到 Issue/PR（是否有别的追踪地方）。
- PM：迁移的目标日期或里程碑（有没有“某月某日必须切到新版”）；协作库车道约定（社媒/广告归 Ray）是否仍有效；是否允许把本账本的脱敏版同步给俊东（见 §4.4）。

---

## 4. Part C：节奏与平衡（简版）

### 4.1 两条线与在制品上限

| 线 | 内容 | 精力 | 在制品上限 |
|---|---|---|---|
| 线 1：当前 ME 继续交付客户 | Social S1–S5（P0）；其他客户窗口的日常 | 约 80% | 同时最多 2 个写入切片，且不碰同一文件 |
| 线 2：迁移到新版 | 账本更新、别重复造闸、插件描述与契约对齐、与俊东的同步 | 约 20% | 同时最多 1 个（且必须是文档/契约级，不是搬代码） |

全局上限 3；超过先排队。迁移执行（搬代码/搬数据）按 §11 打分是 P3，**在 Social S2 通过前不启动**。

### 4.2 每周固定复盘点

- **每周一**（NZ 上午，30 分钟）：我 + 统筹对账三件事——线 1 在制品进度与阻塞；账本哪几行变了；有没有“俊东新做了、我们又在做”的撞车。
- **每周四**：与俊东单向同步一次（经 PM 点头的内容，见 §4.4）；产出只有三行：这周他新做什么、我们新做什么、契约有没有变。

### 4.3 什么情况下暂停“新建”

1. 要新增的东西在 §3.3“别重复造”里，或新版 `main` 近两周已有同名模块 → 先问俊东，不新建。
2. 线 1 有 P0 切片超过 7 天没有进展 → 暂停任何新切片，先解阻塞。
3. 触及共享契约（Kernel 动作、回执、动作身份）→ 公告（协作规则 §3.3）+ 双方确认后再动。
4. A 级且没有 PM 本人“合”→ 停在草稿。

### 4.4 与俊东的同步机制（沿用既有做法）

- 机制：**生产库开 tracking issue → 协作库对应 issue 加 comment 交叉链接**（2026-09-01 CTS Governed Reply Agent 一例）。
- **必须 PM 先点头才同步的**：任何含客户名/客户 id/真实数据的内容；任何契约变更草案；本账本的脱敏版；任何对新版仓库的评论、Issue 或 PR（含“请俊东补首评”这类请求）。
- 可以不问 PM 的：只读调查本身（如本文做的）。
- 建议动作（需 PM 点头）：请俊东在新版仓库开 Issue 追踪（现在没有任何 Issue），否则迁移账本没法跟他的进度对账。

### 4.5 新做的东西怎样保证可迁移

1. 新能力一律写成“契约 + 适配器”：Evidence / ActionCandidate / Receipt / Verification / Outcome / Knowledge 六个逻辑对象映射到**现有表**，不新建平行库（任务说明 §二）。
2. 供应商逻辑只留在 adapter；客户事实（名字、主页、价格、术语）只进 `factory_config` / Playbook / 客户配置，不进共享代码（可用“换成 NM Medspa 再换成地产客户，这段代码要不要改”自检）。
3. 每个新切片的 PR 附一行“迁移边界”：旧版哪张表/字段 ↔ 新版哪个原语（用 §3.4 表）。
4. 新字段命名对齐新版 Extension Contract v1.1 的词（capabilities 的 read/draft/execute/verify/measure；act 必须 requires_verify；外部副作用声明幂等键）。

### 4.6 与现有窗口的接口

| 窗口 | 我需要什么 / 我给什么 |
|---|---|
| 74 CTS 广告总控 | 它管广告预算与 CTS 广告；我只在“Reel → 起广告”的接口（`me/factory.reel.published` 事件被广告侧消费）上要求它：不要改事件结构；R4 的 Reel→暂停广告工作要和 S3a 的转正逻辑对表 |
| 75 CTS 内容 | CTS 的 Reel 内容与审核：它是 S2 的首个真实内容来源；要它提供“独立审核人”是谁，并保证不绕过工厂 |
| 76 CTS 电话 | VoIPLine 通话与录音进 CRM 已在做第一块。**Social 提为最优先后是否继续由统筹转 PM 定**（见 §6）；我的建议：继续，因为它不碰 Social 文件、可并行；但新建能力（点击拨号等）先挂起 |
| 73 SEO 规则手册 | 迁移账本里 SEO 排在最后；手册先行即可，不需要我介入 |
| 62 广告手册 | 同上；Ads 的缺陷修复（A1–A3）由 74/62 在线 1 里排期，我只在契约层核对 |

---

## 5. 派工单草案（编号 80 起，交统筹开卡；标题按「NN-类别-描述」）

> 代码默认交 DeepSeek 写、我（Claude Code）出指令与审（CLAUDE.md §5）。以下三张都含 A 级部分，**不能自动合**，需 PM 本人回「合」。

**80-社媒-Reel转正后补登记效果测量（S3a）**
- 唯一写入者：Claude Code 会话（统筹开）+ DeepSeek 一次性写；文件：`src/lib/inngest/functions/factory-reel-measurement-adapter.ts`、`src/lib/factory/publish/publish-worker.ts`、对应测试。
- 风险：代码 B；对 `fa4fdd89` 补发事件 = 生产写入（单独问 PM）。
- 验收：①测试复现“草稿动作行 + 转正事件”被误判 `not_published`，修后通过；②生产补发一次后，`social.publish_post` 有该工单一行，T+4/T+72 回执出现（T+72 到点读取）；③“当场试跑”：用测试数据完整跑一遍非外发链路。
- 三方审：子牙（架构）+ 魏征（挑刺）；不触及隔离/Kernel，无需狄仁杰。
- 截止：2026-10-14 前（72 小时点是 10-14 NZ 17:35）。

**81-社媒-旧Publer入口关门（S1a）**
- 写入者：同上；文件：`src/lib/flywheel/social-post-publish.ts`、`src/app/api/publer/schedule/route.ts`、`src/app/api/clients/[id]/reels/[draftId]/publish/route.ts`、`src/app/api/publer/create-post/route.ts`、`src/app/api/clients/[id]/content-posts/[postId]/publish/route.ts`、测试。
- 风险：**A**（客户隔离）。验收：账号必须是素材所属客户绑定的账号；删除全部 `accounts[0]` 回退；外部成功本地失败返回 `needs_reconciliation` 并保留外部任务编号、禁止重发；`reels publish` 入口下线或只出草稿（PM 定）。
- 审：子牙 + 魏征 + 狄仁杰。

**82-社媒-工厂工作器写库全检查（S1b）**
- 在 80 合并后开工（同一个文件 `publish-worker.ts`）。风险 **A**（发布）。验收：领单、草稿凭证、`published` 主更新、失败回写全部检查 error；主更新失败进入可查询的“需对账”状态且不重发；重复事件只产生一次外部动作。审：子牙 + 魏征 + 狄仁杰。

后续（S2/S4/S5）等 80–82 合并后再出，避免一次铺太多。

---

## 6. 需要 PM 拍板的事（一次一件）

1. **先做这一件**：同意派 80 号（修 CTS 第三版 Reel 的测量登记，最晚 10-14）。回 `修`。
2. 76 号（CTS 电话）在 Social 提为最优先后是否继续？我建议继续（不碰 Social 文件）。回 `76继续` / `76暂停`。
3. 要不要请俊东在新版仓库建 Issue 追踪（现在一条都没有）？回 `请俊东建`。
4. 迁移有没有硬日期？回日期，或 `没有`。
5. 旧的 `reels/[draftId]/publish` 入口（绕过工厂）下线还是保留成只出草稿？回 `下线` / `只出草稿`。

---

## 7. Reuse Statement 与对账

- 复用了什么：旧版 Daily Plan 严格账号校验当样板；工厂发布工作器与测量接线器（只读核对，未改）；Issue #1413 已合并的 Tune 与授权记录；新版 Extension Contract v1.1 的字段词汇。
- 真正 platform-shared 的新增：无（本文是文档）。
- industry-specific：无。client-specific：CTS 只作为生产验证样本出现，没有写进任何共享代码；文内没有写完整主页 id 或账号号。
- 有没有把客户名/id/行业判断写进 shared runtime：没有（没有改任何运行代码）。
- 学习去向：本文发现的“草稿转正后动作行不更新”属平台机制教训，修复落地后再登记到 Social 通用手册；客户私有部分不外泄。
- 与 tier-gate 决策时的分类是否一致：一致（全程 Inline，未发现需升 Full 的新能力线）。
- 实际检查记录：`git rev-parse`/`status`/`fetch`（退出码 0）；`gh api` 多次 GET（退出码 0，其中 `compare` 对不存在公共祖先的分支返回错误，已放弃该用法）；生产库 GET 查询若干（返回正常）；**未运行**：`npm test`、`npm run type-check`、`npm run build`（文档变更）；**未验证**：Inngest 运行记录、Render 环境变量、新版线上服务。
