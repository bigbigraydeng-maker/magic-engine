# 孔子 / 孟子 / 苏东坡：经验手册持续学习 + Capability / Memory / Kernel 设计 v0

状态：**v0.1**（v0 经魏征设计审，3 BLOCKER 已改，处置见 §0.1） · 作者：子牙 · PM 2026-09-28 要求：「确保孔子、孟子、东坡自身的手册一直都在学习；思考这些 agent 需要什么 capability、memory 和 kernel」
Repository Fact Gate：`origin/main` = `af7cb6f3` · fetched 2026-09-28 01:43 NZDT · 三份支柱现状调研为只读（子牙派出，证据行号见各节）
风险级别：A（设计涉及 Kernel ActionKey、Memory 写入权限、对外写动作收编）
样板：广告支柱「卫青」——`docs/agents/11-weiqing.md`、`docs/specs/2026-09-24-ads-goal-driven-autonomous-impact-loop-v1.md`、`src/lib/capabilities/ads/`、`src/lib/kernel/registry-ads.ts`

---

## 0. 一句话

三个 agent 现在都只有「眼睛」（读数据、出诊断），缺「笼子」（对外写动作没进 Kernel，大多在 Kernel 外直写）和「记性」（效果回看的结论进不了 Memory，下一次不会更好）；经验手册只存在于开发侧记忆文件里，产品读不到、没有自动学习。本设计给出：**(A) 手册持续学习机制**，**(B) 三个 agent 各自的 Capability / Memory / Kernel 目标态与收编顺序**，全部复用卫青已经走通的零件，不新造能力线。

## 0.1 v0 → v0.1 魏征设计审处置

| 编号 | 问题 | 裁定 | 落点 |
|---|---|---|---|
| WP-1 | 事实核对：12 处属实；2 处不属实——`recordSkip` 主干上还不存在（只是「跳过留痕」卡的计划）；`publish-geo-to-github` 只开 PR 不合并，真正直写客户站的是 `publish-geo-snippet`（WordPress / Shopify） | 接受 | §3.5、§4.2 已改；`recordSkip` 标为**依赖**（等「Make skipped cron blocks visible」卡合并） |
| WP-2 | 「只新增 → 自动合」是注入通道：`docs/**` 判 C、GitHub 对只加行也标 modified、机器分不出新增与修订；指针校验在无 token 时放行、`session:` 恒放行、只查存在不查支持 | **BLOCKER，接受** | §3.4 重写：手册正文 A 级、学习任务只写候选区 |
| WP-3 | 学习来源会系统性产出错经验；「多客户已验证」机器判不了 | 接受 | §3.3 收紧来源、升级只能人工 |
| WP-4 | Oztop 退役会双写：插件（仓库外）按 `wp_updated=false` 拉；新旧并存时两路都进同一队列；「插入一行就改站」本身是状态字段当授权；§4.1「变差自动恢复」推翻了 PM 9-20 砍掉自动回滚的决定却没列进 §6 | **BLOCKER，接受** | §4.1 重写退役顺序；自动恢复移入 §6 PM 决定 |
| WP-5 | 批 1（边界测试按真实路径）会一次冒出一批相对 import 违规；10-11 到期的豁免延不延没写 | 接受 | §5 批 1 写明一次性补登规则与豁免延期 |
| WP-6 | 社媒授权漏两条路：`lecture-publish.ts:109`（`publishRequest.live \|\| FACTORY_PUBLISH_LIVE`，`live` 来自请求体）与 `reels/[draftId]/publish` | **BLOCKER，接受** | §4.3 迁移规则重写 |
| WP-7 | 对照卫青缺：信封预检、被拒恢复点、熔断回 observe、数据不全本轮不动、PM 日报署名段、SEO / GEO 同页冲突、`geo.request_content` 谁排优先级、学习任务该不该走 Inngest | 接受 | 新增 §4.4 |
| WP-8 | §11 复算：批 1 纯内部治理应为 P2（靠「前置」排前，不靠抬分）；批 4 发布未卡死，IMPACT 中 → P2；批 0 / 2 频率应为中但仍 P0，批 2 须写出收入高的理由 | 接受 | §5 表已改 |

## 1. 平台层级判定（Tier Classification · Full）

- **被判定对象**：给 SEO / GEO / 社媒三个既有支柱补 Kernel 接入、Memory 学习闭环、手册学习流程。
- **层级**：L1 平台基础设施（Kernel、Memory、Verification）的**复用与接线**，不新增 Capability 线、不新增支柱；各支柱的判据写在各自 `capabilities/<pillar>/`；行业差异进 L2 Playbook（`playbook-*-industry-*`）；客户差异进 L4（`client_automation_policies`、`clients.seo_config`、受保护页名单）。
- **换客户测试**：CTS → Oztop → 悉尼地产客户，Kernel 键、信封字段、Memory 表结构都不需要改；只有 L4 配置不同。**已知违反**：`oztop-seo-optimizer` 写死 Oztop client ID（`src/app/api/cron/oztop-seo-optimizer/route.ts:33`）；`geo-module/verification.ts:16-17` 写死 Roman 基线批次——本设计要求收编时一并移除。
- **换行业测试**：旅游 → 地产 → 电商，判据中的行业词（地名表、价格口径）必须进 L2 Profile，不进共享 runtime（#1948 复审已要求：共享层只留价格 / 日期 / 缩写通用规则）。
- **红线 1–7**：均不触犯；不包装升级、不直建 L1、不把客户事实写进共享代码（上述两处既有违反要清掉）。
- **不登记 platform-candidates**（非新能力）。

## 2. 两层「记忆」，别混

| 层 | 是什么 | 现在在哪 | 谁读 | 问题 |
|---|---|---|---|---|
| **经验手册（Playbook）** | 跨客户的平台 / 行业通用规律（「怎么做对」） | `~/.claude/projects/.../memory/playbook-*.md`（开发侧 Claude 记忆，不在仓库） | 只有 Claude Code 窗口 | 产品 runtime 读不到；改动无审查记录；靠窗口手动补——GEO 手册 9/23 后未动，社媒 9/25 后未动 |
| **客户记忆（Product Memory）** | 每个客户「哪些做法有效 / 失败」 | `client_proven_patterns` / `client_failed_experiments` / `client_learned_preferences` / `client_decision_history`（`docs/agents/00-architecture.md` §5） | 华佗、诸葛亮、鲁班、张骞、马良、李白 | 只从 `flywheel_outcomes` 学；SEO 的整站噪音已被 `classifyActionCase` 挡住（`memory/case-validity.ts:37`），但单页结论进不来；GEO 不在执行证据名单；社媒单帖成绩进不了 outcomes |

PM 说的「手册一直在学习」= 第一层；「memory」= 两层都要。

## 3. (A) 经验手册持续学习

### 3.1 手册搬进仓库
- 三个支柱的通用手册与行业手册搬到 `docs/playbooks/<pillar>/`（`seo/general.md`、`geo/general.md`、`geo/industry-realestate.md`、`social/general.md`；广告、口碑同理后续跟上）。开发侧记忆里保留一行指针，内容以仓库为准。
- 理由：有版本、有审查记录；学习任务能开 PR；将来产品 prompt 可以在构建时引用；「手册改了什么、依据什么」可回查。

### 3.2 每条经验的固定格式（机器可校验）
```
## <一句话规律>
- 规律：…
- 为什么：<事故 / 实测一句话> · 证据：<ledger:路径 | pr:号 | issue:号 | doc:路径>（至少一个，必须真实存在）
- 怎么用：…
- 证据等级：单客户候选 | 多客户已验证（≥2 个付费客户、分属不同客户）
- 最后核实：YYYY-MM-DD
```
「证据」字段复用 `scripts/ledger-check-refs.sh` 的指针校验：写不出能点开的证据，就不许进手册（2026-09-27「已开卡须附位置」同一原则）。

### 3.3 学习来源与节奏（每支柱每周一次，避开周五周六）
学习任务（一个支柱一个；孔子周二、孟子周三、苏东坡周四）读取**本周**：
1. 带该支柱标签、翻成 `verified` / `failed` 的台账卡——**流程类 failed 卡（「PR 没合」「夜巡没来」）不收**，只收关于「做法有效 / 无效」的卡；
2. 该支柱路径上合并的 PR 里，子牙 / 魏征 / 狄仁杰审出、**并且在 PR 里真的被修了**的 BLOCKER / CONCERN（被驳回、被记后续的不收）；
3. `docs/PITFALLS.md` 新增条目；
4. 产品侧已过 Check 的 outcome（见 §4 各支柱）。
**证据等级默认一律「单客户候选」**。升「多客户已验证」只能人工做，门槛照广告 spec：同行业 ≥2 个付费客户、同向且同因（机器只能判「同向」，「同因」要人核），并通过 `checkShareable`。机器不做升级。

### 3.4 合并门槛：手册正文 = 规则书，一律 A 级（WP-2 修正）
- **手册正文**（`docs/playbooks/<pillar>/*.md`，**但 `inbox.md` 除外**，所有窗口开工必读）进判级闸的**治理文件**规则，与 `.claude/`、`CLAUDE.md` 同级 → A 级，子牙签字（PR 评论固定格式）+ PM 合。**没有自动合并这一档**。理由：机器分不出一次改动是「新增」还是「修订」（GitHub 对只加行的文件也标 modified），而一条引用了真实 PR 的新增条目，正文完全可以写成误导性指令，自动合进所有窗口的必读材料。
- **学习任务只写候选区** `docs/playbooks/<pillar>/inbox.md`：这个文件**不列入任何窗口的必读**，判 B，可以自动合。每周由子牙从候选区挑出站得住的，开 A 级 PR 升进正文，一批只问 PM 一次「合」。
- 证据指针的机器检查比台账更严：禁止 `session:`；禁止指向手册自身；没有 GH_TOKEN 时 `pr:` / `issue:` **判不通过**（台账检查那里是放行，这里不能照抄）；正文不许含 10 位以上连续数字和客户私有事实关键词。
- 指针只证明「来源存在」，不证明「来源支持这条结论」。「支持」靠子牙升级时人核。

### 3.5 学习心跳（不许静默）
- 执行载体：学习任务会开 PR（外部副作用），CLAUDE.md §3 默认要求走 Inngest。v1 **例外**用本机定时任务（跟台账夜巡 `ledger-nightly-verify` 同一种），原因是它读的是开发侧材料（台账、PR 审查、PITFALLS），产品运行时拿不到 GitHub 写权限；恢复条件是产品侧有了受控的 GitHub 写凭证；替代回执是每次运行的 PR 号或「本周无候选」记录。本机定时任务挂死过三次，根因是权限模式，已修（`defaultMode=bypassPermissions`）。另外加外部心跳：夜巡顺带检查「三个学习任务本周是否都有运行记录」。
- 依赖：`recordSkip` 还没在主干上（WP-1），等「Make skipped cron blocks visible」卡合并后按下面口径接；在那之前，用运行记录的 summary 字段手写同样的信息。
- 每周学习任务无论有无产出，都用 `recordSkip` 口径写运行记录：「本周无新经验：原因」是**有意跳过**（带 `until` = 下次运行日）；读不到台账 / PR 是**意外跳过**，连续 2 轮进今日待办。
- 「该支柱近 14 天有 ≥1 张 verified/failed 卡，但手册 14 天未变」→ 内部健康报告标黄（不进 PM 待办，除非连续两期）。
- 既有 `playbook-staleness-weekly`（核对手册里点名的代码引用是否还存在）保留，搬仓库后改读新路径。

## 4. (B) 三个 agent 的 Capability / Memory / Kernel 目标态

通用原则（照卫青）：
1. **每个对外写 = 一个 ActionKey + `src/lib/capabilities/<pillar>/<action>.ts` + 撤回处理**；授权模式按客户由 `client_automation_policies` 决定（`observe` / `human_only` / `bounded`）；`bounded` 必有信封（上限、冷却、受保护对象），信封外 = 可恢复的 deny + PM 三件套。
2. **边界测试按解析后的真实路径判**，不只认 `@/lib/...` 写法——SEO 调研发现 `cms/seo-fix-orchestrator.ts:23` 用相对路径 import 绕过了 `architecture.test.ts:271`；#2087 复审（DR87-3）发现同类问题。这是三个支柱共用的前置修复。
3. **Memory 只从「动作级」Check 学**：每个动作写预期指标 → T+N evaluator 写 `flywheel_outcomes`（按动作粒度：SEO 按页、GEO 按问题集、社媒按帖）→ `memory-extractor` 经 `classifyActionCase` 过滤后进 `client_proven_patterns` / `client_failed_experiments`；每个支柱在出处方 / 生成内容前读自己 flywheel 的记忆。
4. **每个 agent 一份手册**：`docs/agents/13-kongzi.md`、`14-sudongpo.md`、`15-mengzi.md`（12 已预留给广告编排「韩信」），含「Memory Layer 接口」读写表（照 `11-weiqing.md` §八）与停手条件。`00-architecture.md` §5.4 写入权限矩阵补上三者。

### 4.1 孔子（SEO）

| | 现状（证据） | 目标态 |
|---|---|---|
| Capability | 外部写 4 条：`seo-meta/cycle/apply-adapter.ts:141-201` 建分支→提交→**自动合并**改客户站；`cms/seo-fix-orchestrator.ts:165` 开 PR；`oztop-seo-optimizer` 写队列、WP 插件每小时自动改站（**无信息完整闸门、无事实核对**）；`gsc/indexing-client.ts`（官方限制，普通页无效） | `capabilities/seo/rewrite-meta.ts`（标题 / 描述，走 #1948 两层事实闸 + 信息完整闸门 + 受保护页）；`capabilities/seo/content-fix.ts`（开 PR，人合）；Oztop 路径**退役**，改走同一个 `seo.rewrite_meta`（WP 适配器作为 provider）；indexing-client 下线 |
| Kernel | 只有 `seo.build_publish_package`（无提交方）、`page.apply_optimization_request`（human_only，零调用方）；seo-meta 三件在临时豁免名单（`boundaries.ts:84-89`，到期 2026-10-11）；无 bounded、无信封 | 新键 `seo.rewrite_meta`（outward，默认 `human_only`；客户经 PM 授权可切 `bounded`：每周 ≤N 页、30 天冷却、受保护页、双闸全过才算在信封内）；`seo.open_content_fix_pr`（human_only）；撤回 = 恢复旧 meta / revert PR，自动；豁免名单清零 |
| Memory | `seo_meta_log` 14 天四档结论（`outcome-classifier.ts:28,54-91`）不进 flywheel、不进记忆（`runner.ts:13` 明确砍掉）；seo-meta / seo-agent 不读记忆 | `seo_meta_log` 结论写 `flywheel_outcomes`（按页，用 #2068 的逐页逐天数据做前后比，不再用整站 28 天差）；出处方前读 `flywheel='seo'` 的 proven / failed |
| Check | 有 14 天四档；「变差」只下一张人工卡让人点 Revert（`runner.ts:13-18`：PM 2026-09-20 拍板砍掉自动回滚） | 保持 PM 9-20 的决定：「变差」→ 三件套人工卡（附一键撤回链接，撤回走 Kernel 处理函数）。**是否恢复自动撤回，列入 §6 由 PM 定**，本设计不推翻 |

**Oztop 退役顺序（WP-4 修正，杜绝双写）**：
0. **已完成（2026-09-27 12:50 UTC，PM 回「停」）**：Render 上暂停 `oztop-seo-optimizer`（`crn-d92e08q8qa3s73d8a7ig`），回读确认 suspended。
1. A 级 PR 删除 `render.yaml` 里的 `oztop-seo-optimizer`（否则下一次 Blueprint 同步可能把它恢复），同 PR 删除路由，或者让它直接返回 410。
2. 插件侧（在 Oztop 的 WordPress 上，不在本仓库）：**切断并删除，不保留**。插件现用 service_role 钥匙每小时拉 `seo_meta_log`（Issue #2145 边缘日志）；「换 Oztop 总钥匙」窗口在 PM 同意后作废旧钥匙与旧签名，插件即拉不到任何东西，随后由 FDE 停用并删除 `oztop-seo-sync`。**以后不再给任何客户网站发数据库钥匙**：Supabase 新式 secret 钥匙都是全权、绕过行级权限，做不出「只读、只看本客户行」的库钥匙；将来客户网站若需要取数，应走 ME 侧按客户鉴权的只读接口（换钥匙窗口技术判断，子牙采纳）。在切断之前：不许「疏通」现在卡住的 20 行（插件查询不分客户，清掉后会拉到 CTS 的行）；**CTS 标题周循环（`runner.ts:430-436`）每改一页也写 `wp_updated=false` 的行**，同样会被插件拉到（WP-4 复核指出）——它在切断前的每一次运行都要评估：插件仍卡在最早 20 条 Oztop 行时风险低；一旦卡住的行被清或钥匙迟迟不作废，周循环 `pr` 通道写入的行必须改为 `wp_updated=true`（它们本就不是给插件的），或暂停周循环。
3. 然后 `seo.rewrite_meta` 才对 Oztop 开放，provider 用 WordPress 适配器（由 ME 侧调用 WordPress 接口写入，不再由客户网站来拉）；在此之前 Oztop 的 meta 改写一律人工。
4. 已上站的 18 个坏标题另开修复（孔子窗口准备方案，PM 定）。
| 定时 | `seo-meta-cycle` 未登记 `cron/registry.ts`；发布后监测无自动触发方；计划写周二、实际周一 | 登记、接上触发；学习任务周二 |

### 4.2 孟子（GEO / AI 可见度）

| | 现状（证据） | 目标态 |
|---|---|---|
| Capability | 测量：`ai-tracker/`（周）、`industry-ai-visibility/`（日）、`diagnostic/ai-visibility-live-probe.ts`，**都花钱**；推理：`geo-module/`（纯函数，无调用方提交）；旧发布路由：`publish-geo-snippet` **直写客户 WordPress / Shopify**，`publish-geo-to-github` 开 PR 不合并，发布内容是给 AI 看的隐藏指令块（`site-audit/geo-detector.ts`）；无 robots / llms.txt 写能力 | 测量统一走 `capabilities/geo/measure.ts`，**事前**预算闸（复用 `geo-remeasure/budget-ledger.ts` 的原子扣账）；处方不自己改站，转两条路：改页面 → `page.apply_optimization_request`（human_only）；要新内容 → 内部 ActionKey `geo.request_content` 交苏东坡 / 李白；**旧的隐藏指令块发布路由退役** |
| Kernel | 无 `geo.*` 键；旧发布路由绕过 Kernel | `geo.measure`（internal，花钱但有信封：每客户每周预算上限，超了 deny）、`geo.request_content`（internal）；页面改动复用 `page.*` |
| Memory | `EXECUTION_GATED_FLYWHEELS` 只有 seo / ads（`case-validity.ts:37`，注释「geo waits for its owner」）；旧周快照只存测成次数、不存尝试次数（`orchestrator.ts:436-477`） | 孟子就是 owner：把 `geo` 加进执行证据名单；周快照补「尝试次数 + 最低样本 + 覆盖率闸」（行业层已有 60% 闸可复用，`snapshot-conclusive.ts:122`）；按问题集粒度写 outcome |
| Check | 自动重测是空壳（`inngest/functions/geo-remeasure.ts:76` 一调就报错）；`geo-module/verification.ts` 写死 Roman 基线 | 实装重测 worker；基线从客户配置读，删 Roman 硬编码 |
| 定时 | 周追踪旧线（Render）与新线（Inngest 灰度）并存；行业每日打的是 `ai-visibility-weekly` 路由；计划写周三、实际周一 | 收敛成一条（新线），旧线退役；登记表对齐 |

### 4.3 苏东坡（社媒 / 内容）

| | 现状（证据） | 目标态 |
|---|---|---|
| Capability | 对外写：日计划发帖（`campaign-daily-plan/publish/route.ts:30`）、工厂发 Reel（`publish-worker.ts` + `facebook-reel-adapter.ts`，不可撤回）、Publer 发帖、评论自动回复（隐藏 / 私信 / 公开回复，`comment-autoreply-engine.ts:355,373,380`）、私信（autoack 自动、draft 人审、出口 `messenger/send.ts`）；**花钱的两处**：`winner-reel-sync/engine.ts:277` 建广告（`:44` 可直接上线）、`meta-ads/boost-post/route.ts:131` 加钱推广 | 全部收编进 `capabilities/social/`；**花钱的两处不归苏东坡**，划给卫青（`capabilities/ads/`，受日预算上限信封约束），与 WP3 重做的 DR87-2 收编合并处理 |
| Kernel | 注册表**零个**社媒动作（`kernel/types.ts:33-43`）；`boundaries.ts:26-37` 只拦了 `publer/client`；发布「授权」有四条路：请求字段 `approved` + `publish_authorization`（`daily-plan-publish.ts:61-72`）、工单状态 approved（`review-apply.ts` ~55-58）、讲课片 `lecture-publish.ts:109` 的 `publishRequest.live \|\| FACTORY_PUBLISH_LIVE`（`live` 来自请求体，`lecture/route.ts:234`）、`reels/[draftId]/publish` 路由；环境变量 `FACTORY_PUBLISH_LIVE` 一开，所有客户都变真发——正是「状态字段当发布授权」反模式 | 新键：`social.publish_post`、`social.publish_reel`（outward，**恒 human_only**：发布红线不放宽，授权 = Kernel 审批回执）；`social.reply_comment`、`social.hide_comment`、`messenger.send_autoack`（outward，`bounded`：content-guard 通过 + 每帖 / 每人频率上限 + 只用已审模板）；`boundaries.ts` 补登 `meta/page-posts`、`meta/comments`、`messenger/send`、`factory/publish/*` |

**发布授权迁移规则（WP-6 修正，不留「两套都能放行」的窗口）**：
1. 四条发布路径（日计划、工厂审片、讲课片、`reels/[draftId]/publish`）**一条都不能漏**，收编清单以 grep 真实外发调用点为准，不以文档为准。
2. 迁移期：真发必须**同时**满足「Kernel 审批回执」**和**旧条件；两条都满足才发。任何一条缺失都不发。
3. `FACTORY_PUBLISH_LIVE` 降级为**只能关、不能开**的全局总闸：它是 false 时一律不发；它是 true 也不构成授权。请求体里的 `live` 字段不再被读。
4. 旧条件全部删除之后，才算迁移完成；删除是独立的 A 级 PR。
5. 不给 PM 加点击：「审片通过」这一步本身就是提交 Kernel 审批，审批人就是原来点通过的人。`human_only` 与现有工厂流程不冲突。
| Memory | 单帖写 `flywheel_actions` 但**故意不写预期指标**，通用归因不加载（`post-measurement-store.ts:10-17`）→ 单帖成绩进不了记忆；`social-post-evaluator.ts` 结论不落库；工厂 `strategist.ts` / `copy-generator.ts` 不读记忆也不读爆款库 | 发帖写预期指标；evaluator 结论写 `flywheel_outcomes`（按帖）；工厂生成前读 `flywheel='social'` 的 proven / failed + `viral_reference_library`；工厂现有的「客户纠错学习」（`lecture-learning.ts`）保留 |
| Check | 4h / 72h 回看已有（`daily-plan-post-measurement`、`factory-reel-measurement-adapter`），明确「本期不做 Tune」 | 接上 evaluator → outcome → memory，即 Tune |
| 定时 | 评论自动回复注释写 30 分钟、实际每小时；winner-reel 无漏跑报警；「爆款发现」每天跑却叫 weekly | 登记表与实际对齐（并入「cron 登记对齐」那张 P1 卡的范围） |

### 4.4 对照卫青样板补齐的共用部件（WP-7）
- **出手前读信封**：每个 `bounded` 动作提交前先调信封预检（照广告 `isWithinEnvelope` / 孔明那一层），信封外直接不提交，写一条可恢复的 deny；被拒动作有恢复点（PM 改了上限或配置后可重考虑）。
- **熔断**：各支柱照 G11 设熔断条件（SEO：一周内 ≥2 页 Check 判「变差」；社媒：同一帖被隐藏 / 举报异常；GEO：探测花费突增），触发即该客户该支柱回 `observe` + 三件套，恢复要 PM 点。
- **数据不全本轮不动**：任何「判定所需数据不完整」的轮次只观察不执行，并留痕（有意跳过带 until）。
- **同页冲突**：SEO 的 `seo.rewrite_meta` 与 GEO 经 `page.apply_optimization_request` 的改动可能碰同一页。冷却按**页面**算，不按动作键算：同一页 30 天内只允许一个支柱改一次，后来者 deny 并注明冲突方。**判定必须在 Kernel 执行那一步原子完成**（按页加锁或唯一约束），不能只靠提交前的信封预检，否则两个支柱同时提交会一起放行。
- **跨支柱排优先级**：`geo.request_content` 交给苏东坡 / 李白的内容请求，由诸葛亮仲裁排期，不由孟子直接占用内容产能。
- **PM 日检署名段**：每日报告里三个支柱各一段「今天做了什么 / 效果 / 学到了什么（本周手册候选区新增几条）」，照广告五段日报。

## 5. 顺序与优先级（§11 三维打分，WP-8 复算）

| 批 | 内容 | 频率 / IMPACT / 收入 → 级 | 风险 |
|---|---|---|---|
| 0 | **Oztop 每周自动改标题无闸**：已暂停（9-27 12:50 UTC）；18 个坏标题修复待 PM 定 | 中（每周）/ 高 / 高（坏标题挂在客户官网）→ **P0** | A |
| 1 | 边界测试按真实路径判（三支柱共用；含 seo-fix-orchestrator 相对路径漏检） | 高 / 中 / 低 → **P2**，但它是批 2、4 的**前置**，所以排在它们前面做 | A |
| 2 | SEO 收编：先删 render.yaml 旧任务，再上 `seo.rewrite_meta`，seo-meta 豁免清零 | 中（每周）/ 高 / 高（W38、9-23、Oztop 三次事实错误上站，直接伤客户）→ **P0** | A |
| 3 | 社媒花钱两处划归卫青、受日上限约束 | 并入 WP3 重做（DR87-2，PM 9-27 已定） | A |
| 4 | 社媒发布 / 回评 / 私信收编进 Kernel（发布恒 human_only，授权改为 Kernel 回执） | 高 / 中（发布没卡死）/ 中 → **P2** | A |
| 5 | GEO：测量事前预算闸 + 旧隐藏指令发布路由退役 | 中 / 高 / 中 → **P2** | A |
| 6 | 三支柱 Memory 闭环（预期指标 → outcome → extractor → 出处方 / 生成前读） | 中 / 高 / 中 → **P2** | B |
| 7 | 手册搬仓库 + 候选区 + 周学习任务 + 学习心跳 | 高 / 中 / 低 → **P2** | A（手册正文是治理文件） |
| 8 | 三份 agent 手册 + `00-architecture.md` 权限矩阵 | 中 / 中 / 低 → **P2** | C |

批 1、2、4 同改 `boundaries.ts` / Kernel 注册表：**串行、同一写入者**，先 1，再 2，再 4。
**批 1 的一次性补登规则（WP-5）**：按真实路径判定后，一次会冒出一批既有的相对路径违规。处理办法是在同一个 PR 里，把它们**一次性**补登进冻结清单（只准变短的那张），每条附台账卡和子牙签字，之后清单照旧只准变短。seo-meta 那三条豁免 10-11 到期：**延期到批 2 合并那天**，延期写进同一张台账卡，不许无限期。

## 6. 需要 PM 决定的（只这些）

1. ~~Oztop 自动改标题是否先停~~ —— **PM 2026-09-27 回「停」，已执行**。后续：18 个坏标题怎么恢复、要不要告诉 Oztop（孔子窗口出方案后问）。
2. **GEO 旧的「给 AI 看的隐藏指令块」**：已发布在客户网站上的要不要撤下（对客户可见的内容变更）。
3. **哪个客户、哪个支柱开 `bounded`**：跟广告一样，每个客户每个动作单独授权；默认全部 `human_only` / `observe`。
4. **SEO「效果变差」要不要恢复自动撤回**：PM 2026-09-20 拍板砍掉了自动回滚（`runner.ts:13-18`）。本设计维持该决定（变差 → 人工卡 + 一键撤回链接），除非 PM 改主意。

其余（键名、信封字段、测试、顺序）为技术决定，由子牙定、魏征复审。

## 7. 子牙九问自答（`docs/agents/10-ziya.md` §四b）

1. 与现有架构矛盾吗？不矛盾：照搬卫青的 Kernel / 信封 / Memory 闭环；`00-architecture.md` §5.4 写入权限矩阵需补三者。
2. Memory 写入权限？新增：孔子写 `flywheel='seo'`、孟子写 `geo`、苏东坡写 `social` 的 proven / failed（经 extractor 统一写，agent 不直写）；手册由周学习任务开 PR，不直写。
3. 空 / 错 / 超量？学习任务读不到台账 → 意外跳过进待办；无新经验 → 有意跳过；手册条目缺证据 → CI 拒；Memory 只收过了 `classifyActionCase` 的动作级结论。
4. 假设？GSC 逐页数据（#2068）上线后稳定可用；各 provider 撤回能力（WP / GitHub 可恢复，Meta Reel 发布不可撤回 → 恒 human_only）。AU/NZ 口径：行业词进 L2。
5. 6 个月瓶颈？ActionKey 数量增长——注册表按支柱分文件（照 `registry-ads.ts`）。
6. 权限矩阵影响？三 agent 获得各自 capability 目录的对外写，但全部经 Kernel；花钱动作只归卫青。
7. 失败谁先感知？每个对外写有回执 + 撤回；Check 变差 → 三件套人工卡 + 一键撤回链接（维持 PM 9-20「不自动回滚」，是否恢复见 §6 第 4 条）；学习任务失败 → 心跳。
8. 闸门跳过留痕？学习任务、测量、Check 的每道跳过都按 `recordSkip` 口径留痕（有意带 until、意外连续 2 轮进待办）；`recordSkip` 主干尚未有，是依赖，合并前用运行记录 summary 手写同样信息。
9. 调度登记一致？本设计涉及的 seo-meta-cycle、GEO 两条周线、社媒几条 cron 均要求登记对齐（并入 P1 cron 对齐卡）。

## 8. Reuse Statement

- 复用：Kernel（ActionKey / `client_automation_policies` / 信封 / 撤回 / 审批回执）、`capabilities/ads` 的写法、`memory-extractor` + `classifyActionCase`、`flywheel_outcomes`、#1948 事实闸、`recordSkip` 跳过留痕（**依赖，主干尚未有**）、台账指针校验、`playbook-staleness-weekly`、#2068 逐页数据、`geo-remeasure/budget-ledger`。
- 新增 platform-shared：各支柱 ActionKey 与 capability 文件、手册格式 CI、周学习任务（本机定时任务）。
- industry-specific：地名 / 价格口径等进 L2 手册与 Profile。client-specific：授权模式、上限、受保护页（L4）。
- 需清除的既有违反：Oztop client ID 写死（`oztop-seo-optimizer/route.ts:33`）、Roman 基线写死（`geo-module/verification.ts:16-17`）。
