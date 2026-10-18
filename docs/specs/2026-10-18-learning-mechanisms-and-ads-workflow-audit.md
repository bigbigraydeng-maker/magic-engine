# ME 学习机制 + 广告工作流规则 · 只读核查（119 号，2026-10-18）

- PM 10-18 要的两个重点：**①广告工作流（统筹的方法）②一套能不断学习提升的方法（根据外部视频/文章）**。
- **只读核查，没写代码、没动库。** 每条先 grep 调用点 / 查生产库再下结论，**不信代码注释**
  （这个仓库的注释经常描述的是已经修掉的旧问题 —— 我今天自己栽过两次，见文末）。
- 生产库 = `glbdnayojylf…`（ME 生产库），只跑 SELECT。

---

## 0. 一句话结论

**「学习」这件事，ME 有三类东西：真在跑的、建好但断在最后一环的、和压根没有的。
而 PM 要的「从外部视频/文章学」属于第二类 —— 管线有、来源里就写着行业媒体，但它 9 月 13 日之后再没写过一行，
而且它的产出只喂页面、不喂任何 AI 判断。**

---

## 1. 七套学习/记忆机制的真实状态（逐项查实）

| 机制 | 分类 | 实情（证据） |
|---|---|---|
| **memory-extractor**（投放结果 → proven / failed / preferences） | **已有且在跑** | 近 7 天 7 次全成、最后 10-17 06:31；消费方是真的（`memory/service.ts:101` → 华佗/诸葛/鲁班/张骞的 prompt）。**但三张记忆表自 10-05 起 13 天零新增**，每天 summary 固定 `outcomes_stale_skipped: 49` 纹丝不动，而库里 confirmed 64 / reversed 70 都是今天算的 —— 不是没证据，是被某道去重挡住 |
| **agent-learning-rollup**（周度汇总） | 🔴 **已有但断，根因已定位** | 全历史 12 轮、**写入 0 行**。`learning-rollup.ts:214` 把 `` `${isoWeek}::${clientId}` `` 当 `extracted_from_id` 传进去，而生产库那一列是 **uuid** → 插入必然报错，而 `service.ts:333` 把错误 `console.error` 掉就 `return null`。**一个类型不匹配，让一条周度学习回路空转了三个月** |
| **write-lesson / `global_learned_lessons`**（跨客户经验） | **只有壳子（有读无写）** | 有消费方（`service.ts:160` 进 agent prompt + 广告引擎看板）；但唯一的新增 API `api/ad-engine/lessons/route.ts:43` **没有任何前端调用方**（页面那个按钮打的是 PATCH 改开关）。12 行，最后写入 **8-08** |
| **team-memory**（会话 → 提炼） | **已有但断，且"已停"没停** | 上游 `work_sessions` 停在 **8-22**，`team_lessons` 近 30 天 0 行。⚠️ 仓库里 `render.yaml:1288-1299` 和 `cron/registry.ts:264` 都已把它注释掉、标注「已暂停」，**但 Render 上那个任务还在每 30 分钟跑，近 7 天 336 次全是空跑** |
| **knowledge**（`client_knowledge_facts`） | **只有壳子（读的那侧是线上真用）** | 读取方是**线上客服 Agent**（`messenger-agent/tools.ts:169,282`、私信草稿生成），真在用；但写入只能靠人工在 Inngest 后台发事件或跑一次性脚本 —— `grep 'mining.requested'` **零个发事件方**。全表 **7 行**，挖掘只跑过 **1 次（9-16）** |
| **playbook-staleness-weekly**（手册过期巡检） | 🔴 **只有壳子（连表都没有）** | 见 §4。补一条本次查实：`supabase_migrations.schema_migrations` 里**没有** `20260924000000`，接口**全历史 0 次运行** |
| **`viral_reference_library`**（爆款配方） | 🔴 **已有但断 —— 而这正是 PM 要的那条回路** | 见下方单独一节 |
| **`web_intelligence_external_observations`**（外部文章） | **已有但断** | 见 §3 |
| **`flywheel/tune/`** | **只有壳子，不构成学习回路** | **零持久化、零调度**（`grep insert/upsert/update` 零命中），纯按页面请求现算 REPEAT/ITERATE/STOP；输入 `social_post_measurement_receipts` 全表 **4 行**、9-09 后无新增；`loadPostCohort`（同期对照组）**零调用方**。结论不落库、不影响下一次自动决策 |

### 🔴 1b. PM 要的「从外部视频学」其实早就有了，它被一个免费额度卡死

**`viral_reference_library` 是七套里唯一一条真正「从站外内容学」的回路**：
抓 YouTube 公开视频（`api/cron/viral-discovery-weekly`，每天跑）→ 用 Gemini 把它拆成**可复用的配方**
（`lib/reels/viral-analyzer.ts`）→ 出 reel 时真被读走（`viral-style-advisor.ts:161-198`、`factory/viral-structure.ts:130`、
推广计划与社媒计划生成）。**抓取端和分析端近 7 天都在跑。**

**断在中间那一步**：

| | 数 |
|---|---|
| 全表 | 3,923 行，近 30 天新增 **551** |
| 近 30 天真拆出配方（`done`） | **22** |
| 近 30 天失败（`error`） | **529** |
| 失败原因（库里原文） | **549 条是 Gemini 429**：`Quota exceeded … generate_content_free_tier_requests, limit: 20, model: gemini-2.5-flash` |

**也就是：每天灌进来约 80 条外部视频，而分析端还在免费档、每天只允许 20 次调用 → 成功率约 4%。**
**这不是代码问题，是额度问题。**——**PM 要的「持续学习」这条线，花钱升一档 Gemini 配额就能从 4% 拉上来，不需要开发。**

---

## 2. 广告工作流的规则：哪些落成代码、哪些还是纸面、跟 WP3.2 冲不冲突

**查的两份**：`docs/sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md`（62 号，729 行）、
`docs/agents/11-weiqing.md`（253 行）。

| 问 | 答（带证据） |
|---|---|
| SOP 自己有没有逐条标「已有代码 / 缺代码」？ | **没有**（全文 `缺代码` 命中 0 次、`已有代码` 1 次）。它的形式是 **W 编号工作包 + 三维打分**，不是逐条代码对照表。所以「哪些落了代码」要外部核，不能照抄它 |
| SOP 自己说卡在哪 | §1b.5 原话：**「平台级：『每天』基本齐；『每周』只有零件；『每月』『每季』和『事件触发后的跟进』几乎是空的。行业级七个空只有一个有地方放。客户级十一个空，多数客户只填了三四个」** |
| **跟 WP3.2 冲不冲突** | **不冲突，而且它预设了 WP3.2 的存在**。SOP 全文**不提韩信/WP3.2**，但两处（`:266` 挪钱链、`:330` W11、`:652` X3）写明「**必须走工作流编排，每一步留回执**」。那个编排层就是 WP3.2 要做的东西 —— 现在没有，所以这几条 SOP 规则**今天没有落点** |
| 卫青人设的规则有没有被代码读 | **没有**。代码里出现「卫青」的 8 处全是**注释署名**（「卫青复审抓出…」`envelope-facts.ts:70`、`portfolio/diagnostics/loader.ts:263` 等）。它的**巡察那一半是真实现了**（`ads-strategy/agents/patrol.ts`，每天写 `ads_growth_states`），但人设文档本身不被任何程序读 |
| 谁依赖这份 SOP | `docs/clients/cts/2026-10-11-cts-ads-master-plan-v1.0.md:28` 把它整份列为依据；`docs/sops/2026-10-11-seo-agent-playbook-and-rules-v1.0.md:5` 把它当格式范本 |

**归类**：SOP 是**纸面规则 + 工作包清单**，不是已落地的工作流；它点名要的「工作流编排」属**真缺**（= WP3.2）。

---

## 3. 「从外部视频/文章学东西」的入口：**已有但断**

**有这条管线**，叫 web-intelligence，不叫我原先猜的那些名字：

| 件 | 实情（证据） |
|---|---|
| 抓取层 | `src/lib/web-intelligence/apify-external.ts`（走 Apify），上层 `external-run.ts` |
| **来源里真的有文章类** | `web-intelligence/sources.ts:15-18`：Travel Today、TRAVELinc Memo、Tourism New Zealand News（`industry_media` / `industry_news`），外加 SEEK / Indeed 招聘、公开与授权 Facebook 群、竞品网站流量 |
| 落到哪张表 | **`web_intelligence_external_observations`**（注意：不是 `external_observations`，名字带前缀） |
| 谁触发 | 只有 **API / 页面**：`api/clients/[id]/web-intelligence/external/route.ts`、`…/traffic-direction/route.ts`。Inngest 那个函数（`inngest/functions/web-intelligence.ts`）**只做 traffic-direction**，不抓文章。`render.yaml` 里**没有任何调度** |
| 生产库实情 | 全表 **36 行**：jobs 18、website 14、**industry_media 4**；**最后一次写入 2026-09-13，近 30 天 0 行** |
| 谁消费 | 只有 `web-intelligence/service.ts:27-28` 读它，而 service 的调用方全是**页面/接口**（web-intelligence 视图、tour-landscape、tour-landscape/chat）。**没有任何 AI 决策链消费它** —— 不进孔明处方、不进 playbook、不进 `global_learned_lessons` |
| 视频/转写 | **没有**。全仓 `transcript` / youtube 相关只有发布侧（`inngest/functions/youtube-publish.ts`），**没有「把外部视频转成文字再学」的入口** |

**归类：已有但断。** 断在三处：**没有调度**（只能人点）、**5 周没写过**、**产出不进任何学习层**。

**最小接法（建议，没动手）**：不要新建管线。两步：
1. 给现有的文章抓取加一条**定时触发**（它已经有 Inngest 函数，加一个事件即可），让 `industry_media` / `industry_news` 持续进表；
2. 把它接到**已有的 `global_learned_lessons`**（跨客户经验）而不是 playbook ——
   理由：playbook 在 Claude 记忆里、程序读不到（见 §4），而 `global_learned_lessons` 是库里的表、
   程序能读能写；外部文章是「跨客户的通用经验」，归属上正好对。
   **视频先不做**（要转写，是另一笔成本，且 ME 目前没有转写入口）。

---

## 4. 哪些规则只活在 Claude 记忆里，而代码/窗口却依赖它

按 CLAUDE.md 的设计，5–7 本支柱手册**故意**放在 Claude 持久记忆里（`~/.claude/projects/.../memory/playbook-*.md`），不在仓库。
问题不是「为什么不在仓库」，而是**代码已经在依赖它们，而 Codex/DeepSeek 读不到**：

| 依赖形式 | 具体位置 |
|---|---|
| **代码写死了手册文件名** | `src/lib/pm-todo/playbook-staleness-items.ts:35-39` 把 5 本手册的文件名硬编码成登记表 |
| **代码注释把手册章节当作行为依据** | `src/lib/seo-meta/cycle/hard-fact-check.ts:13`（「repo memory playbook-seo-general.md §5」）、`src/lib/crm/lead-followup-due.ts:91`（「playbook-geo-general §九：没测成 ≠ 测出来是零」）、`src/lib/industry-ai-visibility/orchestrator.ts:355`（「playbook-geo-general §八」） |

**已经有一条桥，但远端是断的（这是本节最要紧的发现）**：

`playbook-staleness-items.ts:1-22` 自述：有一个**本机 Claude 定时任务**
（`~/.claude/scheduled-tasks/playbook-staleness-weekly/`）读手册原文、grep 这个仓库核实手册里点名的
函数/路径/表名还在不在，把「疑似过期」POST 给 `/api/cron/playbook-staleness-weekly` 落库到
`playbook_staleness_findings`，今日待办再把它摆给人看。

**核实结果**：

| 环 | 实情 |
|---|---|
| 本机任务目录 | **存在**，但只有一个 `SKILL.md`（9-24 建，之后没动过） |
| 接口 | **存在**（`src/app/api/cron/playbook-staleness-weekly/route.ts` + 测试） |
| 待办那一栏 | **已挂**（`manual-items.ts:97,459`） |
| 建表文件 | **仓库里有**：`supabase/migrations/20260924000000_playbook_staleness_findings.sql` |
| **生产库那张表** | 🔴 **不存在**（查询直接报 `relation "playbook_staleness_findings" does not exist`）→ **迁移从没执行过** |
| 后果 | `pushPlaybookStalenessItems` 必然抛错，而它在 `manual-items.ts:459` 被 `.catch()` 兜住 → **静默失效，待办里永远不会出现这一栏** |

**归类：已有但断** —— 代码齐、任务齐、待办齐，**只差一次 migration apply**，而这一环从 9-24 断到今天。
**这一条修起来最便宜**（apply 一次迁移，A 级写库动作，要 PM 点头），修完「手册过期」就会自己找上 PM。

**仍然只在记忆里、程序完全读不到的**：手册**正文**（判据、阈值、事故教训）。
那条桥只搬「疑似过期的线索」，**不搬内容**。所以 Codex/DeepSeek 看到
`hard-fact-check.ts:13` 那句「见 playbook-seo-general.md §5」时，**打不开它引的东西**。

---

## 5. 分三类的汇总

| 类 | 条目 |
|---|---|
| **已有且在跑** | memory-extractor（但 10-05 起零新增）；卫青每日巡察（`ads_growth_states`，10-17 在写）；账户体检 + 组合诊断（10-17）；爆款库的**抓取端**（近 30 天 +551） |
| **已有但断** | **爆款库的分析端**（Gemini 免费额度，成功率 4%）；**周度汇总**（uuid 类型不匹配，三个月写入 0 行）；team-memory（上游 8-22 断供，且「已停」没在 Render 生效、7 天空跑 336 次）；外部文章（9-13 后零写入、产出不回流）；手册过期巡检（生产库缺表、迁移从未应用、异常被吞） |
| **只有壳子** | `global_learned_lessons`（有读无写，最后 8-08）；`client_knowledge_facts`（线上客服真在读，但只有 7 行、挖掘跑过 1 次）；`flywheel/tune`（零持久化零调度，不构成学习回路） |
| **真缺** | 工作流编排层（SOP 两处点名「必须走工作流编排」→ 就是 WP3.2）；手册**正文**对程序可读（那条桥只搬线索不搬内容）；外部**文章**回流成记忆（现在读完即丢） |

### 5b. 按「改起来多便宜」排的四件（给 PM 挑）

| 顺 | 做什么 | 代价 | 换来什么 |
|---|---|---|---|
| 1 | **给 Gemini 升一档配额** | 花钱，不用开发 | 「从外部视频学」成功率从 ~4% 回到正常；这是 PM 要的那条回路本身 |
| 2 | **apply 那张缺的表** | 一次 migration（A 级写库，要 PM 点头） | 手册过期巡检立刻开始找上 PM；代码/任务/待办早就齐了 |
| 3 | **修周度汇总那个类型错** | 很小一刀（B 级） | 一条空转三个月的周度学习回路开始真写入 |
| 4 | **把 Render 上那个「已停」的任务真停掉** | 一次配置（要确认是谁的权限） | 停掉每 30 分钟一次的空跑 |

**第 1 件不是开发任务**，所以它排第一：PM 一句话就能让那条回路活过来。

---

## 6. 未核实（不许当结论用）

- **memory-extractor 为什么从 10-05 起零新增** —— 每天 `outcomes_stale_skipped: 49` 固定不变，是去重还是别的闸挡住，没查到底。**这一条值得单独开一刀。**
- `playbook-staleness-weekly` 那个仓库外的本机定时任务**到底装没装、有没有在尝试 POST** —— 仓库里查不到，只能证实接口从未被成功调用过。
- 外部文章那条线 10-01 那轮月度 Inngest 任务有没有真触发 —— Inngest 运行记录不在 `cron_run_logs`，没查后台。
- 62 号 SOP 里 W1–W11 / X1–X3 各包的代码现状 —— 只核了「SOP 没有自带代码对照表」和「它预设编排层」，**没有逐包核**。

- 那个本机定时任务**到底有没有在被调度器触发**（目录里只有 SKILL.md，我没查调度器注册表）。
  即使表建好了，这一环也可能还是不跑。
- `20260924000000_playbook_staleness_findings.sql` **为什么没 apply** —— 没查当时的 PR/台账。
- 外部文章那条线 9-13 之后停写的原因（是没人点，还是 Apify 那边坏了）—— 没查。
- 62 号 SOP 里 W1–W11 / X1–X3 各包的代码现状 —— 本稿只核了「SOP 没有自带代码对照表」和「它预设编排层」，**没有逐包核**。

---

## 7. 方法论备注（为什么本稿每条都带证据）

我今天在这个窗口栽过两次**同一类**错，都是**把文档里的旧问题陈述当成现状**：
①把熔断的「按计划半成品」说成「坏闸」；②照一段讲「早先会…」的注释去建议加一行文案，而那件事同一个提交就修好了。
所以本稿的规矩是：**每一条状态结论都要有 grep 到的调用点或库里查到的行数/时间**，拿不准的一律进 §6。
