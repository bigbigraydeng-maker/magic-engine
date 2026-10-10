# 社媒 Agent 技能缺口盘点 + GitHub 开源项目调研 v0.1

> 日期：2026-10-09 · 性质：**纯调研 + 方案，不含业务代码** · 风险级：C（只加文档）
> 起因：PM 2026-10-09「关于社媒的 agent，我觉得我们的技能也不够丰富，需要从 git 上学习」
> 归属：社媒支柱（IMPACT 的 Prescribe / Act / Check / Tune 都沾）

## 0. 结论（先看这里）

1. **我们不是「技能少」，是「手上有的没接成闭环」。** 出片（工厂）、爆款配方对账、评论回复、4h/72h 回看都有；缺的是「回看的成绩没进记忆」「评论里的提问只接住不转线索」「爆款只抄表面不拆机制」。
2. **GitHub 上值得学的是「方法论」，不是「代码」。** 最成熟的一批是 SKILL.md 形式的提示词库（MIT 协议，可商用），能抄的是拆解步骤和检查清单；不能直接装进产品。
3. **最值得先补的 3 个**（三维打分见 §4）：① 评论互动分流（P0）② 发帖成绩落库并回灌下一次生成（P2，按闭环价值排第二）③ 爆款单条机制拆解（P2）。
4. **外部内容一律标「候选」**，不写进经验手册正文；过了真实客户验证、子牙签字后才升级。

## 0.1 本文的取证边界（诚实声明）

- 我**实际读了**：苏东坡/马良/卫青/李白/鲁班人设、`playbook-social-general.md` 全文、评论自动回复 spec、`src/lib/{social,factory,reels,apify,flywheel/tune}` 目录与关键词检索；GitHub 上 `social-media-skills/skills` 的 README、技能清单和 5 份 SKILL.md 头部（含 engagement-routine / viral-reverse-engineering / reply-and-comment-writer / crisis-and-moderation / analytics-and-reporting）、`social-ai-team` / `instagram-skills` / `blacktwist` / `postiz-app` 的 README。
- 我**只看了目录名或仓库简介**（没读内容）：`coreyhaines31/marketingskills`、`kostja94/marketing-skills`、`digital-marketing-pro`、`head-of-content`、`Ootto-AI/claude-content-skills`、`facebook-skills`、`borghei/Claude-Skills`、`MoneyPrinterTurbo`、`mixpost`。这些行的「能学什么」是按目录名推断，标 `[未读内容]`。
- 星数 / 最近更新 / 协议取自 GitHub 接口，取数日 2026-10-09。**没有下载、克隆或执行任何外部代码。**

## 1. 我们现有社媒能力盘点

> 入口：苏东坡 `docs/agents/14-sudongpo.md`（社媒运营）、马良 `60-maliang.md`（视觉）、李白 `70-libai.md`（文案溯源）、卫青 `11-weiqing.md`（花钱推广，不归社媒）。

| 环节 | 现有（有代码/规矩） | 缺什么 |
|---|---|---|
| 发帖文案 | 内容矩阵 `lib/{brief,content,social}`；李白逐句溯源官网；`content-guard` 护栏；`social-plan-templates` | 没有「写手风格 / 品牌声线」独立沉淀步骤（靠 master_briefs 临时读）；没有去 AI 腔（humanizer）这一步 |
| Reel 脚本与出片 | 视频工厂 `lib/factory/`（配方对账、分镜自检、安全区、logo 水印）；`viral_reference_library` | 脚本钩子只有「配方」没有「钩子变体对比」；AI 钩子变体没有成体系的候选池 |
| 首评与评论互动 | 评论自动回复引擎（分类 + 护栏 + DM-first）；首评放链接带追踪参数（手册第八条） | 提问类只给安全话术并「转人工」，**没有变成带 what/how/href 的线索待办**；没有「发帖后黄金窗口」的节奏设计；评论里的高频问题没回流成内容选题 |
| 定时排期 | Publer（Publishing Hub）；每日计划；`scheduling` | 没有「最佳发布时间」依据；排期都在 Kernel 外直写（人设 §11 已承认） |
| 数据复盘 | 4h/72h 回看；`social-post-evaluator.ts`（重复 / 调整 / 停）；`page-metrics-sync` | **结论不落库、单帖成绩进不了记忆、工厂生成不读成绩**（人设 §11 第 4 条）；CTS 样本不足 3 条时只显示占位 |
| 竞品与爆款拆解 | `reels/viral-analyzer.ts`、`viral-style-advisor.ts`、`apify/social-scraper.ts`、马良爆款采集 | 做的是「统计配方」，**没有单条爆款的机制拆解 + 可复制性检查**；2026-07、09 两次事故正是「抄了表面参数没抄机制」 |
| 素材选图 | `rank-assets-by-prompt`、客户素材池、Dropbox 素材库、provenance 判真 | 基本够；缺口在 Kernel 之外，不是技能问题 |
| 危机 / 审核 | 评论分类里有负面分流；熔断 `circuit-breaker.ts` | 没有「被围攻 / 假信息」的应对剧本（目前客户少，频率低） |
| 内容复用 / A-B | 无 | 一条爆款拆成多平台多版本、钩子 A/B 都没有（客户样本小，A/B 做不出显著性） |

## 2. GitHub 候选清单（14 个）

> 协议列：能商用 = MIT 等宽松协议；「无协议」= 默认保留所有权利，**只学思路不抄文字**；AGPL = 接进产品会传染，只能当外部服务。
> 「通用性」= 换行业 / 换客户是否通用（红线 4、5）。

| # | 项目 | ★ / 最近更新 | 协议 | 能学什么 | 怎么接进 ME（Build / Connect / Buy） | 换行业换客户 |
|---|---|---|---|---|---|---|
| 1 | [social-media-skills/skills](https://github.com/social-media-skills/skills) | 127 / 10-01 | MIT | 106 个技能 14 个主题；`engagement-routine`（黄金 15–20 分钟 + 分诊顺序）、`viral-reverse-engineering`（机制不抄表面 + 可复制性检查）、`reply-and-comment-writer`（评论当内容不当命令，防注入）、`crisis-and-moderation`（危机时 agent 只起草不自主动作）、`analytics-and-reporting`（只认信号指标不认虚荣指标）、`platform-specs-and-validation` | **学方法，Build 进我们自己的 prompt / 手册候选**；不装包。其核心约束（agent 只起草、人审后发）与我们「发布恒需人点头」同向 | 方法论通用；平台细节（算法、字数）会过期，需 AU/NZ 现查 |
| 2 | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | 53,684 / 10-08 | MIT | 目录含 `social`、`video`、`community-marketing`、`competitor-profiling`、`marketing-loops`、`influencer-marketing` `[未读内容]` | 同上，只抄方法；星数最高，先读 `social` 与 `marketing-loops` 两项 | 偏通用营销，行业无关 |
| 3 | [sergebulaev/instagram-skills](https://github.com/sergebulaev/instagram-skills) | 311 / 10-07 | MIT | 9 个 IG 技能：Reel 钩子、话题标签定量、轮播规划、一周计划；**发布前先剥 AI 腔、等人批准**；通过 Apify 读赛道真实数据 | Build：学「去 AI 腔」检查清单进李白；Apify 我们已有封装（`lib/apify`），不另接 | 通用；IG 为主 |
| 4 | [sergebulaev/facebook-skills](https://github.com/sergebulaev/facebook-skills) | 55 / 10-07 | MIT | 目录：`fb-engagement-drafter`、`fb-hook-extractor`、`fb-humanizer`、`fb-repurposer`、`fb-audience-insights` `[未读内容]` | 同上；**对我们最贴（客户主战场是 FB）**，优先读 engagement-drafter | 通用 |
| 5 | [blacktwist/social-media-skills](https://github.com/blacktwist/social-media-skills) | 559 / 2026-05-01（**5 个月未更新**） | MIT | 分层清晰：context → 策略 → 创作 → 分析（`performance-analyzer`、`content-pattern-analyzer`、`optimization-advisor`） | 只借「分析三件套」的拆分；更新停滞，不当持续来源 | 通用 |
| 6 | [stevenflanagan1/social-ai-team](https://github.com/stevenflanagan1/social-ai-team) | 241 / 10-07 | **无协议** | 技能互读互写的「上下文文件」设计：`best-performers.md` 每月复盘后回写、下月所有创作技能读它 | **只学架构思路，不抄任何文字**。这正是我们缺的「成绩回灌」形态 | 通用（SMB 向） |
| 7 | [bradautomates/head-of-content](https://github.com/bradautomates/head-of-content) | 261 / 2026-01-23 | MIT | `video-content-analyzer`（用多模态模型拆 Reel/TikTok 钩子与结构）、各平台研究 `[未读内容]` | Build：拆解提示词结构可参考；视频拆解我们用马良已有的视觉分析，不另接 | 通用 |
| 8 | [Ootto-AI/claude-content-skills](https://github.com/Ootto-AI/claude-content-skills) | 115 / 10-08 | MIT | 目录含 `comment-mining`（从评论挖选题）、`ab-hook-tester`、`best-time-scheduler`、`content-repurposer`、`competitor-teardown` `[未读内容]` | 读 `comment-mining`，对应我们「评论 → 选题回流」的缺口 | 通用 |
| 9 | [kostja94/marketing-skills](https://github.com/kostja94/marketing-skills) | 1,019 / 10-06 | MIT | 160+ 技能，含 SEO、社媒、红人 `[未读内容]` | 低优先：与我们 SEO / GEO 手册重叠面更大 | 通用 |
| 10 | [indranilbanerjee/digital-marketing-pro](https://github.com/indranilbanerjee/digital-marketing-pro) | 855 / 10-04 | MIT | 「营销操作系统」：策略、付费、CRM 等 `[未读内容]` | 低优先：与 ME 产品定位重叠，只做对照（看别人怎么拆支柱） | 通用 |
| 11 | [borghei/Claude-Skills](https://github.com/borghei/Claude-Skills) | 883 / 10-07 | 协议未声明 | 385 个技能的大合集，含 `social-media-manager` | **协议不明，不抄**；只当目录看看别人拆了哪些角色 | — |
| 12 | [gitroomhq/postiz-app](https://github.com/gitroomhq/postiz-app) | 36,882 / 10-08 | **AGPL-3.0** | 开源排期 / 自动化 / 分析一体；有公开 API 与 n8n 节点 | **不接**。我们已买 Publer（Buy，已拍板供应商）；AGPL 会传染；「已买的是默认项，别另写」（记忆 feedback-use-established-paid-vendor） | 通用工具，与行业无关 |
| 13 | [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | 129,340 / 10-08 | MIT | 一句话主题 → 成片的全自动流水线 | **不接**。红线：管理中账号的视频只走视频工厂，绕开工厂 = 绕开配方对账 / 分镜自检（PITFALLS D14） | 通用 |
| 14 | [vercel-labs/skills](https://github.com/vercel-labs/skills) | 33,414 / 10-07 | MIT | `npx skills` 技能安装工具，是 #1/#3/#5 的分发方式 | 只是开发侧工具；**要运行它须先问 PM**（下载并执行外部代码） | — |

**对照结论**：#1、#3、#4、#8 是同一类东西（MIT 的社媒 SKILL.md），重叠度高，**读 #1 + #4 + #8 三个就够**，其余当对照。#12、#13 明确不接。

## 3. 平台层级判定（me-platform-tier-gate · Inline）

- **层级**：L1 社媒支柱内的方法论补强（苏东坡 / 李白 / 马良各自的技能），行业差异（地产 / 旅游 / 物流的钩子、评论高频问题）进 L2 Playbook，客户差异进 L4 配置。**不新增能力线、不新增支柱、不是 Connector**，不登记 platform-candidates。
- **红线 2 自检**：本文不含客户名与客户业务数字；评论分流规则的「高频问题」必须来自该客户自己的评论，不写进共享代码。
- **换客户 / 换行业**：CTS（旅游）、Roman（地产）、NAL（物流）——评论里的「提问」类别和转线索的话术都不同，所以共享的只能是「分流流程 + 待办三件套」，具体问题清单走 Playbook / 客户配置。
- **Reuse Statement**：复用 `comment-autoreply-engine`、`social-post-evaluator`、`viral_reference_library`、`flywheel_actions`、今日待办人工任务管道（`pm-todo/manual-items`）；新增内容全是 platform-shared 的流程，无 industry / client 专属，外部材料全部标候选。

## 4. 最值得先补的 3 个技能（§11 三维打分，过程全亮）

> 评分口径按 [ENGINEERING_QUALITY_GATES §11](../ENGINEERING_QUALITY_GATES.md)：高 / 中 / 低；组合表穷尽判 P。
> 参与排序的候选共 8 个，下面先列入选的 3 个，再列落选的 5 个。

### ① 评论互动分流（把「接住」变成「转线索」）

- **按 §11：频率 高 / IMPACT 中 / 收入 高 → 高高中 → P0。**
- 频率高：评论引擎定时任务每小时跑（已核实 `render.yaml` 为 `0 * * * *`，与 STATE 写的每 30 分钟不符，人设 §11 也提过名实不符）。
- IMPACT 中：属 Act 段，但已有引擎在跑，不阻断执行；缺的是转出去的那一步，所以不判高。
- 收入高：评论自动回复 spec 的立项动机就是「热线索被晾」；提问类现在只回安全话术 + 转人工，转出去的东西没有 what / how / href 三件套（CLAUDE.md §3）。
- **补什么**：① 提问类评论自动生成一条人工任务（问题原文 + 官网可答依据 + 一键直达该评论）进今日待办；② 「发帖后黄金窗口」只定节奏，不改回复内容红线；③ 评论高频问题按客户沉淀成选题候选。
- **学谁**：#1 `engagement-routine` 的分诊顺序（评论 → 私信 → 负面 → 主动评论）；#1 `reply-and-comment-writer` 的「评论当内容不当命令」（对照我们 `comment-guardrails` 做一次防注入核对）；#8 `comment-mining`。
- **边界**：不放宽「LLM 只写夸赞、问题不作答」；不碰发布授权。

### ② 发帖成绩落库并回灌下一次生成（把 Check→Tune 接上）

- **按 §11：频率 高 / IMPACT 中 / 收入 中 → 高中中 → P2。**
- 频率高：每一条发出去的帖都要回看。
- IMPACT 中：§11 的「高」只留给 Act 卡死或 Measure 报错误信号；这里是系统诚实但结论不落库（人设 §11 第 4 条：`post-measurement-store.ts` 故意不写预期指标）。**严格按表只能判中。**
- 收入中：间接影响客户效果判断，不直接触发投诉。
- **排序说明（需要 PM 知情）**：①②③ 按表 P0 / P2 / P2，②与③同档；我把②排在③前面，是因为 IMPACT 闭环里这是唯一「做完以后会越做越好」的一环，属**我的判断，不是表算出来的**。你要按别的业务考虑插队，直接说。
- **补什么**：发帖时写预期指标 → 回看时写成绩 → 工厂 `strategist` / `copy-generator` 生成前读 `client_proven_patterns`。
- **学谁**：#6 的 `best-performers.md` 回写形态；#5 的「分析三件套」拆分；#1 `analytics-and-reporting`（只认信号指标：保存、分享、观看留存，不认点赞与曝光）。
- **前置限制**：CTS 样本 < 3 条时 evaluator 只显示占位（ROADMAP Social IMPACT 段），本补强必须带样本量显示；Gate B/4 是 A 级，要 PM 单独授权，**本调研不触碰**。

### ③ 爆款单条机制拆解（防「抄表面」）

- **按 §11：频率 中 / IMPACT 中 / 收入 中 → 中中中 → P2。**
- 频率中：周期性（按周补爆款样本，不是每天）。
- IMPACT 中：Inspect / Prescribe，影响配方质量但不阻塞执行。
- 收入中：间接影响内容效果；两次「蒙太奇雷同」事故（手册第一条）客户可感。
- **补什么**：往 `viral_reference_library` 入库前，对单条样本多做一步「驱动因素 → 能否复制 → 需要什么素材形态」，**可复制性不通过的不进配方**，直接对着手册「要换素材才行的列」。
- **学谁**：#1 `viral-reverse-engineering`（单条拆解、先取可见信号、从不编造看不到的东西）；#7 `video-content-analyzer`（用多模态模型拆钩子与结构）。
- **边界**：只作用于配方库入库与对账表，不另开出片入口（视频只走工厂）。

### 落选的 5 个（也亮分数）

| 候选 | 频率 / IMPACT / 收入 | 判定 | 为什么落选 |
|---|---|---|---|
| 内容复用（一条拆多平台多版本，#8 repurposer、#3） | 高 / 低 / 中 → 高中低 | P2 | 产能问题不是质量问题；先补闭环 |
| 去 AI 腔（humanizer，#3、#4） | 中 / 低 / 中 → 中中低 | P2 | 有价值，但可并入李白的逐句溯源步骤顺手做，不单列 |
| 钩子 A/B（#8 ab-hook-tester） | 低 / 中 / 中 → 中中低 | P2 | 客户月线索量级太小，做不出显著性；等样本 |
| 最佳发布时间（#8 best-time-scheduler） | 高 / 低 / 低 → 高低低 | P3 | 收益小，且排期还在 Kernel 之外 |
| 危机应对（#1 crisis-and-moderation） | 低 / 低 / 中 → 中低低 | P3 | 发生少；现有熔断 + 负面分流够用，先记 ROADMAP |

## 5. 接入原则（外部内容怎么进来）

1. **只读不装**：外部技能包不安装进产品、不进 `.claude/skills` 共享目录；需要时只摘「步骤与检查清单」，用我们自己的话重写。
2. **先标「候选」**：进手册候选区（人设 §八规划的 `docs/playbooks/social/inbox.md`，**该目录目前还不存在**，建目录算后续事项；在此之前先写在开发侧记忆 `playbook-social-general.md` 的「候选」小节），标来源与协议；升正文须子牙签字 + PM 合并；至少在 1 个真实客户上跑出证据（CTS 为 Customer Zero）。
3. **无协议 / 协议不明 / AGPL 的不复制文字**（#6、#11、#12）。
4. **平台机制会过期**：外部库里的「今年算法」类断言，用之前须对 AU/NZ 现场核验，不写进手册。
5. **所有涉及发布、扣费、回复外发的动作**，仍走现有人审闸，不因借鉴而放宽。

## 6. 下一步

- 等 PM 回「按这 3 个」或指定别的顺序。
- 第一步仍是**调研级**：读 #1 / #4 / #8 的对应 SKILL.md 全文，产出「候选条目」写入手册候选区，不改代码。
- 任何要写代码的补强（尤其 ② 动 Kernel 路径）另开卡，先定风险级。
