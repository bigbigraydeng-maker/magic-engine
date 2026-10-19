# 社媒 Agent 能力地图与六平台接口合同 设计稿 v0.3

- **日期**：2026-10-19 ｜ **风险级**：C（只有文档；不写代码、不改库、不新增页面；设计稿获 PM 点头前不开工）
- **v0.2 → v0.3**：子牙 + 魏征复审 v0.2（11 条必改：闭合 8 条、部分闭合 3 条）后的必修版。要点：S2 验收加「有真实数据的窗口」；S5 之前表现由 97 号人工读；一页话补「创意层本体这一批不做」、冻结令说明、授权项拆开；合同接口表补三行；`SocialAuthorization` 全部归类；「不新建表」范围改为 S1–S2
- **v0.1 → v0.2**：子牙 + 魏征审后的必改项全部并入（协调窗口 10-19 转达 11 条）。要点：删掉「连接坏了没人报警」断点和 S6；连接状态改为引用 Codex 已有类型；补回执落哪张表、`findExisting` / `onStarted` / `listRecentPosts`、「草稿永不映射成已发布」；写清创意层与排期 agent 的分工和跨支柱查重；第一批切片缩为 S1 + S2；待拍板项拆成「我定」「PM 必须本人回」「一次问一个」三类
- **基线**：写稿日 origin/main `97df00ac7`（2026-10-19，已含 #2758）；推送时已刷新并合并到 origin/main `caa175838`（本分支用一次合并随推送带上）；生产库只读 SELECT；在途 PR 以 2026-10-19 `gh pr list --state open` 为准
- **来源约定**：每个事实后带 `[文件:行号]`、`[查询]`、`[PR n]`；查不到写「未验证」；外部平台的数字一律写「待核」，不凭记忆填

---

## 0. 给 PM 的一页话

**第一件事：社媒 Agent 不是新系统，是「社媒」这根支柱的干活形态。**
零件大半已在：视频工厂、发前审查清单、Facebook 发布、连接断线提醒、学习卡。缺的是三处接线和一块「内容创意」。

**第二件事：最重要的三个「断」。**
一，发出去的帖子表现怎样，系统读不到、也没回到下一轮计划（单条表现记录全库只有 4 行）。
二，短视频（Reel）发布最后一步靠人手；近 30 天标「已发布」的 17 条里，14 条其实只是存成草稿。
三，已发的内容几乎没有分类标签（开头类型、栏目、选题来源），所以分不出「哪种开头更好」。

**第三件事：你点名的内容创作，叫「创意层」，是社媒 Agent 里负责「想」的那块（脑）。**
它想短视频的结构、钩子、脚本、背景音乐、转场，图片的风格，标题正文首评；图文和短视频一起管；「做」仍交给视频工厂。不新增能力线，也不起新名字。
**创意层本体（S5）这一批不做**，要等分类标签和单条表现先有数据。分工已定：文案统一由创意层写、苏东坡签字的是创意层那一份（97 号确认采纳），**但要等 S5 上线才生效**，现在仍按人手周包走（第 3.5 节）。

**第四件事：六个平台各有一个负责连接和发布的「手」，由 Codex 做。**
我先写了「脑」和「手」之间的约定草案，叫接口合同（第 5 节），重点是读不到数据要说「读不到」而不是 0。

**第五件事：存成草稿，永远不能记成「已发布」。**
这条已写进合同的硬规则；每次动作留下的记录叫回执，落在现有的表里，不新建表。

**第六件事：第一批只做两片，都不新建表；做完学习卡很可能仍然验证不了。**
①给工单加分类标签；②把单条表现读出来，**由 97 号人工读**后用在下一轮排期（现在排期是人手周包，没有程序会读它）。我直说：Facebook 没有看观看数的权限，短视频每周约 3 条、凑够样本要数周，标签又是创意层自己填的、不是实测，所以 9 张社媒学习卡大概率仍是「查不了」。这两片的价值是先把数据管道铺好（第 7 节）。

**第七件事：冻结令我没找到原文。**
我按闭环清单里社媒线的两个断点（发布最后一步、发布后表现回写）取舍，对不上的一律推迟；你认为不对请改。

**第八件事：先问你一件事——要不要申请 YouTube 分析权限？**
申请会改变授权范围，可能影响现有连接，所以必须你本人回，我不会替你默认。回 `申请` 或 `不申请`（我的建议：`不申请`）。
Instagram 发布权限与 Meta 应用审核也是授权项，点头后单独问你；Threads / X 做不做、背景音乐曲库范围，之后一件一件问。

回 `点头`，之后会发生三件事：第一，我把第 7 节的 S1、S2 两片分给写代码的窗口，各开一个小 PR；第二，这两个 PR 仍要走子牙 + 魏征审，自动合并规则不变；第三，其余切片先不动，等对应的缺口真有调用方再开。

---

## 1. 开工核对与层级判定

### 1.1 读了什么、没读到什么
| 项 | 结果 |
|---|---|
| 仓库根 `CLAUDE.md`、`me-platform-tier-gate`、`ME_PRODUCT_DEFINITION.md` | 已读 |
| 社媒日常设计稿 v0.5（476 行） | 已读（下称「v0.5」） |
| 专家学习 spec、技能卡 README、社媒规则摘要 | 已读 |
| 首轮学习验证 `docs/audits/2026-10-19-social-learning-first-verification.md` | 不在主干，在 PR 2904（未合并），我读的是该 PR 的文件 |
| 社媒操作手册草案 `docs/sops/2026-10-19-social-agent-playbook-and-rules-v1.0.md` | 已读；它是 A 级草案、待 PM 批准，**未生效** |
| 记忆手册 `playbook-social-general.md`、两份出片红线 | 已读（Claude 本机记忆，Codex 读不到，所以本稿把用到的事实写在正文里，标 `[记忆:playbook-social §n]`） |
| 「冻结令」 | 没找到单独的文件。能核到的是台账 `2026-10-18-sidebar-regroup-118.md:13`（PM 10-18「优先简化功能」）和 `me-agent-standard-process-v1.0.md:4`（「只列地基，不加新能力」）。**「闭合闭环清单」我按 `2026-10-18-me-closed-loop-skeleton-min-cost.md`（已在主干）「社媒」行的两个断点来对：断点① 发布最后一步（总开关没开→草稿→人工转公开，回执不回写）；断点② 发布后表现回写计划**。第 7 节每片都对到其中之一，对不上的标「按冻结令推迟」 |

### 1.2 Tier Classification Report（Full）

**被判定对象**：①「社媒 Agent」能力地图；②其中新增的「内容创意」（创意层）；③脑与手之间的六平台接口合同。

**建议层级**：
- 社媒 Agent = 既有 **L1「社媒」支柱**的执行形态，不新增能力线。
- 创意层的机制（需求单格式、标签词表、选曲与转场规则、文案结构、学习机制）= L1 社媒支柱下的平台层机制；配方与风格偏好 = **L2 行业 Playbook**；VI、口吻、红线词、素材 = **L4 客户配置**。
- 六平台接口 = **L3 Connector**（Codex 做的「手」）。

**归属**：[x] ME 6 支柱之一：社媒。（不是新支柱，不是新垂直版本。）

**换客户测试：通过 ✓**
- 反例客户 1（CTS，旅游，英文团、没有销售截止）：默认值里没有「不写倒计时」之类；这类规则在客户层 `client_config`。默认行为不需改。
- 反例客户 2（East Inter，全英文）：语言是客户层字段；默认值不假设中文字幕或英文字幕。
- 反例客户 3（Roman，地产）：事实来源池（价格、日期、房源）靠客户层官网接地，默认值只规定「必须有可溯来源」。

**换行业测试：通过 ✓（带一条诚实限制）**
- 反例行业 1（旅游→地产）：钩子类型词表从 `viral_reference_library` 的行业切片取，地产有 392 行样本 [查询]；无行业样本时回退通用词表并标「无行业证据」。
- 反例行业 2（旅游→餐饮 / 健身）：同上，餐饮 311 行、健身 477 行 [查询]。
- **限制**：这些样本约 94% 来自 YouTube（见 4.3），对 Facebook / TikTok / Instagram 的迁移有效性**未验证**，所以只当「候选」。

**智能层 or 执行手**：创意层 = 智能层（脑）；六平台接口 = 执行手（L3，受治理的 Read / Act / Verify）。

**红线检查**：
- 红线 1（禁包装升级）：✓。不叫「创意智能层」，不新设能力线；创意层是社媒支柱内的一块。Threads / X 只是社媒下的 L3 连接，不新增支柱。
- 红线 2（禁客户 / 行业事实进共享代码）：✓。CTS 禁用词、时间、事实库只当例子；默认值里不出现。第 7 节切片验收里写了「共享代码里 grep 不到客户名」。
- 红线 3（禁直建 L1）：✓。不新建 L1；L3 连接器按判据直接归位，不占候选名额。
- 红线 4 / 5（换客户 / 换行业）：见上，✓。
- 红线 6（L1 走五道 Build Gate）：不适用（无新 L1）。
- 红线 7（L2 只装行业级）：✓。行业层只装词表权重与配方；客户事实下沉 L4。

**PM 待拍板项**：见第 8 节。「Threads / X 做不做」属商业决策，留给 PM 一次问一个；「创意层是否起能力名」在本稿内定为**不起名**（归位既有社媒支柱，不新增能力，属技术分类，不升 PM）。

**结论**：
- 原本想法层级：社媒 Agent = 新能力（PM 对话里的说法）；
- Skill 判定层级：**既有 L1 社媒支柱的执行形态 + L3 连接器**；
- 改口话术：不说「ME 新增社媒 Agent 能力线」，说「ME 的社媒能力补齐内容创意、表现回写和六平台连接」；
- 登记候选：**不登记** `platform-candidates.md`（归位既有 L1 / L3，不占候选名额）；
- 下一步：等 PM 点头，再开第 7 节第一批（S1、S2）。
- **跨支柱查重**：创意层与广告创意池、`copy-generator`、产品定义 §8 第 4 条的关系见 3.6；结论是复用、暂不下沉，下沉触发条件已写明。

**按 CLAUDE.md §11 资源优先级打分**：频率 高（天天发）/ IMPACT 闭环关键度 高（卡在 Measure 和 Tune，给错误信号）/ 收入关联 中（CTS、East Inter 在投，影响续费但不直接）→ 高高中 → **P0**（§11.2 表：高高高、高高中 = P0；这与 PM 10-15 定的「社媒是 P0」一致）。

### 1.3 与 v0.5 对齐、不重复、不推翻
| v0.5 已有 | 本稿怎么处理 |
|---|---|
| 发布日历、候选、名额、授权（v0.5 §2A） | 不动。本稿只在「候选」前面加一步：创意层把候选的「内容怎么做」写完整 |
| 排期 agent 定「做什么、什么角色、哪天」（§3） | 不动。创意层接它的槽位，产出「怎么做」；两者分工见 3.1 |
| 发后巡检 A1–A6、B1–B8、两档调整、5A 自动下架（§5、5A） | 不动，不重复。合同里「撤回」只定接口形状，不解冻 |
| 数据口径：读不到≠0、带样本量（§6） | 沿用，并把它写成合同的硬规则（5.3） |
| 复盘 R1–R8（§7） | 沿用。本稿补的是「复盘所需的数据先要有标签」（切片 S1、S2） |
| **§1.5 冻结项**：首评自动发布、评论自动回复、AI 文案直接自动发出 | **不解冻**。合同里这些能力标 `gated`，由别处的安全修复决定何时放开 |
| §8.2「不做：Instagram、改授权范围、申请洞察权限」 | **一致**。本稿对 Instagram 只列矩阵与合同，对 YouTube 分析权限只列为 PM 待拍板项 |

**冲突处（需要 PM 知道）**：v0.5 §3.1 把「Story 早=灵感、午=事实、晚=邀请私信」写在「旅游行业层」；本稿保持这个落点不变，但提醒：这套角色分工目前**只有旅游一个行业、一个客户的经验**，属 v0.5 §7.1 所说「候选」，不是已验证规律。

---

## 2. 能力地图（按 IMPACT 六环）

状态：**通** = 生产在跑且有证据；**半通** = 代码在但没真跑 / 只覆盖一部分；**断** = 该有的没有或接不上；**未验证** = 我没能核到。

### 2.1 Inspect（发现）与 Measure（量）
| # | 能力 | 状态 | 证据 |
|---|---|---|---|
| 1 | 平台连接健康（授权有没有断） | **通（已有；缺的是把状态喂给脑）** | 断线判据 `connection-health.ts`（含 `HEARTBEAT_POLICY`）+ 待办管道 `src/lib/pm-todo/platform-connection-items.ts` 已在生产；台账 `2026-09-25-platform-oauth-connection-health.md` 状态 verified，9-27 真实邮件里出现过断线待办。**令牌到期不等于断线**：TikTok / YouTube 有刷新令牌；协调窗口核对 YouTube 10-18 懒刷新正常；TikTok 状态 active、同步时间为空，更像没人用（`tiktok/token.ts` 使用前会续期，而 `HEARTBEAT_POLICY` 记 TikTok 无刷新实现，两处口径不一致，**未验证**哪个对，不当断线）。**缺口**：排期 / 创意层读不到 `SocialChannelStatus`，排期时不知道哪个平台「待刷新」或不可用（并入 S5 的输入，不单列切片）|
| 2 | 爆款参考库（别人的开头 / 镜头配方） | **通（但偏 YouTube）** | `viral_reference_library` 共约 3,945 行，开场钩子字段 `opening_hook` 有 2,623 行，镜头配方 `shot_recipe` 141 行（其中 2 行带错误）；约 94% 来自 YouTube、5% 小红书。**镜头配方只有 YouTube 旅游 133 条 + TikTok 旅游 8 条；Facebook 14 行没有镜头配方、仅 3 行有开场钩子**；Instagram / Threads / X 为 0 [查询，附录] |
| 3 | 页面级每日汇总（发帖数、互动、断更天数） | **半通** | `flywheel_metrics` 的 `social.fb.*` 148 行 / 4 客户；最近一次 `metricsWritten:0`，5 客户中 3 个主页读取报错 [首轮验证 §1；`2026-10-18-social-closed-loop-registry.md` ②] |
| 4 | **单条帖子表现读取** | **断** | `social_post_measurement_receipts` 全库 4 行（CTS，09-06~09），近 30 天 0 行；原因：Reel 接线器要求动作行为 PUBLISHED，实际永远 DRAFT [闭环登记表 ②] |
| 5 | Reel / 主页观看数 | **断（权限）** | 授权清单没有 `read_insights`，洞察返回空数据 [v0.5 §6] |
| 6 | Story 发后量 | **断** | `story_items` 54 条：SENT 11、PENDING 36、BLOCKED 5、MISSED 2；`last_check_result` 非空只有 2 条（都是 MISSED），已发送的 11 条为 0 条 [查询 2026-10-19]。首轮验证 §1 的「SENT 11 条中 2 条有检查结果」口径对不上，以本查询为准 |
| 7 | 评论入库与分类 | **通** | `social_comment_engagements` 110 行（praise 45、question 8、complaint 3…）；但没挂到工厂帖、没连到选题 [首轮验证 §1] |
| 8 | 平台趋势 / 搜索需求 / 站内洞察 | **断** | 没有 TikTok 搜索洞察、Threads 洞察、Instagram 专业面板读取的任何接口 [首轮验证 §1 代码 grep] |
| 9 | 网站来源拆到单条内容（utm_content） | **未验证** | v0.5 §6：`ga4/client.ts` 能读来源 + 媒介，能否拆到单条没试 |

### 2.2 Prescribe（开处方）
| # | 能力 | 状态 | 证据 |
|---|---|---|---|
| 10 | 排期（发什么、几点、什么角色） | **半通** | 现在是人手周包，设计为发布日历的自动报名 [v0.5 §3.3、§2A.5] |
| 11 | **创意处方（钩子、结构、脚本、BGM、转场、图片风格、文字）** | **断** | 只有分散零件：配方库、`viral-style-advisor.ts`、`shot-recipes.ts`（转场白名单）、`copy-generator.ts`（文案）；没有一个「把它们合成一张需求单」的环节，更没有「选了什么」的结构化记录（开场风格标签 2/21、配方 1/21、栏目 0、趋势 0）[首轮验证 §1] |
| 12 | 内容值不值得发（`worth_posting`） | **半通** | 只走流程（苏东坡判），代码延后 [v0.5 §3.4] |
| 13 | 复盘 R1–R8 | **断** | 设计有，未跑；第一次复盘定 10-27；且无单条数据可复盘 [v0.5 §7] |

### 2.3 Act（做、发、回）
| # | 能力 | 状态 | 证据 |
|---|---|---|---|
| 14 | 视频生产（共享生产线） | **通** | 视频工厂 `src/lib/factory/`：模板、配方对账、分镜自检；已发工单 21 条（Facebook 20、Oztop 1）[首轮验证 §1] |
| 15 | 发前审查 | **通** | `content-review.ts` 16 项检查键；价格闸 `price-fact-gate.ts` [v0.5 §1.3] |
| 16 | Facebook Reel 发布 | **半通** | 工厂 + `facebook-reel-adapter.ts` 在用；但没开总开关时存草稿却记「已发布」（近 30 天 17 张已发布工单里 14 张是草稿、3 张真公开，2026-10-19 查询），转公开靠人手且不回写 [闭环登记表 ①；PR 2817 在途] |
| 17 | Facebook 图文 Post 发布 | **半通** | `dailyPlanAutoPublish` 已注册，授权表 0 行，近 14 天 0 条真发 [闭环登记表] |
| 18 | Facebook Story 发布 | **通（小量）** | `story-lite`，近 14 天尝试 10 次、成功 8 且有回执、错过时段 2 [闭环登记表 ③] |
| 19 | 首评 / 回评论 | **半通（冻结）** | `ensureFacebookFirstComment`、`replyToComment` 代码在；自动回复在冻结期 [v0.5 §1.5] |
| 20 | YouTube Shorts 发布 | **半通** | 私享暂存 + 七道公开前检查（`gates.ts`）代码在；ME 自己的回执表 0 行，已发 Shorts 由 Codex 过渡期做、回执靠 PR 2708 补写 [首轮验证 §1；`2026-10-16-youtube-shorts-handover-to-me.md`] |
| 21 | TikTok 发布 | **半通** | `publishToTikTok` 直发已建；应用未过审前发出去只有作者自己可见；令牌到期（见 #1）[`tiktok-adapter.ts:1-12`] |
| 22 | **Instagram / Threads / X 发布** | **断** | Instagram 的跟发适配器随已退役的发布服务一并删除（PR 2756 / 2758 已合并，主干 `factory/publish` 下已无 Instagram 适配器）；原生 Instagram 只有身份接入（PR 2897）；`src/lib/meta/instagram-stories.ts` 有 Story 的 Graph 层函数，但调用方和授权**未验证**；Threads、X 没有任何实现 [`2026-10-19-social-channel-onboarding.md` 平台表] |

### 2.4 Check（查）与 Tune（调）
| # | 能力 | 状态 | 证据 |
|---|---|---|---|
| 23 | 发后巡检（发出去＝批准的） | **半通** | 设计 + 人工清单；只读脚本待做 [v0.5 §5、§8.1] |
| 24 | 熔断 | **断** | `circuit-breaker.ts` 纯函数，文件自述未接生产 [v0.5 §1.3] |
| 25 | 自动下架 | **断（设计已批，实现未开）** | v0.5 §5A，需新表，A 级 |
| 26 | 外部学习→验证→写进规则 | **半通** | 9 张社媒学习卡全是 `learning`；首轮验证 8 个 `cannot_check`、1 个 `not_applicable`；原因是缺单条数据与标签 [PR 2904] |
| 27 | 核实日 / 夜巡 | **通** | `docs/ledger` + `calendar-closure-audit` 等 [闭环骨架稿] |

### 2.5 「断」的前四项（v0.1 的第 4 项「连接坏了没人报警」已删，见 #1）
1. **单条表现读取与回写**（#4、#5、#6）：没有它，创意层选了什么都无从验证，学习机制全部 `cannot_check`。
2. **Reel 发布最后一步**（#16）：「已发布」不可信，表现采集的前提不成立。
3. **创意标签缺失**（#11）：即使有数据也分不了组。
4. **Instagram 发布 / Threads / X / YouTube 分析读取没有「手」**（#8、#22）：属 Codex 在做的 L3 连接，不是本稿的活，只定合同。

---

## 3. 创意层：「想」与「做」分开

### 3.1 边界
```
排期 agent（v0.5）           创意层（本稿）                    视频工厂 / 图文生产线（共享）
定槽位：渠道、格式、角色、  接槽位 → 想：开头、结构、脚本、     照需求单做 → 配方对账表 →
希望哪天、事实库编号     →  BGM、转场、图片风格、文字    →   分镜自检 → 独立审查（苏东坡/马良）
                              输出一张「创意需求单」(3.4)        → 成片回到社媒 Agent
```
- **创意层只想不做**：不调生图 / 生视频接口、不发布（遵守 CLAUDE.md §8：视频一律走工厂）。
- **生产方与检查方分开**：创意层写需求单，工厂做，苏东坡 / 马良审；创意层不给自己的产出签字。
- **图文与短视频一起管**：同一张需求单有 `format` 字段，图文帖、轮播、Story 图、Reel / Shorts / TikTok 视频都用它。

### 3.2 创意层要决定的七件事（PM 点名的）与现有零件
| 创意项 | 平台层（框架 / 规则） | 行业层（配方 / 偏好） | 客户层（红线 / 口吻） | 现有零件 |
|---|---|---|---|---|
| **开头钩子** | 开场类型词表；规则「第一帧不用纯风景空镜，用文字钩子」 `[记忆:playbook-social §一]`；首帧不撞脸（一周内不连续同图同版式）`[v0.5 §3.5]` | 该行业高播放样本的开场类型分布（如旅游行业 `opening_hook.type` 分布）| 客户禁用开场（例：不用倒计时）| `viral_reference_library`、`viral-style-advisor.ts` |
| **视频结构** | 三段 hook / middle / cta；总长与段长由配方注册表定 | 行业配方（镜头数、切点、真人出镜 / 航拍等素材形态）| 可用素材形态（有无实拍）| `factory/recipe.ts`（`WINNER_RECIPE_IDS`、版本号）、`shot-recipes.ts` |
| **脚本 / 口播 / 屏幕字幕** | 屏幕字幕短句大字，一行 ≤6 词；长句只进正文 `[记忆:playbook-social §三]`；ASR 转写必须人工核 `§十九` | 行业常用叙事（问题-解决方案等，候选）| 口吻、语言、禁用词 | `copy-generator.ts`（含 `ctaIntentFor`）、`content-quality-guard.ts` |
| **背景音乐** | 来源只用已授权曲库；按内容情绪分段选曲，原生淡入淡出；人声 100% 时音乐约 20–25% `[记忆:playbook-social §十七]`；7 天内不重复（已有发布闸 `bgm_not_repeated_in_7_days`）；相邻内容不同曲 | 行业情绪偏好（候选，无证据）| 受众节奏（例：中老年放慢）| `remotion-daily-plan/music.ts`（节拍网格、14.5–18 秒）、`youtube-publish/gates.ts` |
| **转场** | 只用已验证的转场白名单（`XfadeTransition`）；配方定转场，brief 不可覆盖 | 行业快切 / 慢切偏好（候选）| — | `shot-recipes.ts:20`、`recipe.ts`（R8：recipe 路径下转场由配方定义）|
| **图片风格** | 来源真实性：只有客户实拍才能当「产品 / 展厅承诺」；图库图和 AI 图只做氛围 `[记忆:playbook-social §五]`；画面里可识别的招牌路牌＝硬证据 `§二十三`；安全区 y=270~1248 `§二` | 行业风格标签（`style_tags`，如 fast-cut、ugc-style）| VI（先读 `master_briefs`）、logo 水印 | `master_briefs` VI、`client-asset-pool.ts`、`scene-tag-guard` |
| **配的文字（标题、正文、首评）** | 链接放首评不放正文，首评链接必带追踪参数 `[记忆:playbook-social §八]`；价格只写官网当前价；事实必须官网可溯（CLAUDE.md §8）| 行业文案结构（候选）| 禁用词、口吻、语言 | `copy-generator.ts`、`price-fact-gate.ts`、`first-comment.ts` |

### 3.3 创意层怎么「想」（工作流，写规则不写代码）
1. 接槽位（平台、格式、角色、目标指标）；
2. 读三层上下文：平台规格（第 4 节）→ 行业配方（只取同行业、同平台样本；无则回退并标「无行业证据」）→ 客户层（VI、事实库、红线词）；
3. **必须输出配方对账表**（配方每一列 → 这次怎么满足 → 满足 / 未满足 / 不适用）；**只满足节奏参数、不满足素材形态的，必须诚实标「缺口」**（CLAUDE.md §8、记忆 `feedback-viral-reel-recipe-over-montage`：两次事故的根因）；
4. 写需求单，带结构化标签（3.4）；
5. 工厂做 → 分镜自检 → 独立审查 → 回来；
6. 发出后，表现回到这张需求单的标签上（S2），喂下一轮。

### 3.4 创意需求单（草案，契约形状；放进 `content_work_orders.brief` 的 JSON，不新建表）
```ts
// 建议位置：src/lib/social/creative/request.ts（Zod 为准，下为形状）
CreativeRequest = {
  schema_version: 1,
  request_id: string,                 // 幂等
  client_id: string,
  slot: { platform: ChannelPlatform, format: CreativeFormat, role: string,
          wanted_date?: string, calendar_candidate_id?: string },
  objective: { expected_metric: string },        // 复用 ctaIntentFor 的指标词
  hook: { opening_type: OpeningType, first_frame_text?: string, differs_from: string[] },
  structure: { recipe_id?: string, recipe_version?: number,
               segments: Array<{ role: 'hook'|'middle'|'cta', seconds: number, transition?: Xfade }> },
  script: { on_screen_lines: string[], voiceover?: string },     // 屏幕字幕 ≤6 词/行
  audio: { bgm_mood: string, bgm_source: 'licensed_library', bgm_track_id?: string },
  visual: { style_tags: string[], footage_provenance: 'client_real'|'stock'|'ai', safe_zone_checked: boolean },
  text: { title?: string, body: string, first_comment?: string, cta_url?: string, hashtags?: string[] },
  evidence: { fact_ids: string[], website_evidence_refs: string[], recipe_reconciliation_ref: string },
  tags: { opening_type: OpeningType, series?: string, topic_source: 'trend'|'evergreen'|'comment'|'calendar',
          bgm_track_id?: string, platform: ChannelPlatform },     // 这五个就是 S1 要落的标签
  gaps: string[],                    // 诚实缺口
}
CreativeFormat = 'reel'|'short'|'tiktok_video'|'story_image'|'story_video'|'post_image'|'carousel'|'short_text'
OpeningType  // 起始词表取自 viral_reference_library.opening_hook.type 的实际值（见 4.3），不自编
```
**说明**：`tags` 五项正是首轮验证缺口 3（开场类型、栏目、选题来源、配方）加上 BGM 与平台。已发工单 brief 现有键见 4.2。

### 3.5 创意层与排期 agent 的分工：谁写、谁签、哪一份是准的

v0.5 §3.1 的审批矩阵里有「新写一句文案 → 苏东坡」，没写清是谁在写；§3.3 又让排期 agent 直接写候选。为避免两处各写一次，本稿定：

| 事项 | 谁做 | 以哪一份为准 |
|---|---|---|
| 定槽位：渠道、格式、角色、希望哪天、事实库编号、素材指纹 | **排期 agent**（v0.5 不变）| 日历候选行 |
| 写一条内容的钩子、结构、脚本、BGM、转场、图片风格、**标题 / 正文 / 首评 / 屏幕字幕** | **创意层**（唯一的文案作者）| **创意需求单（3.4）的 `text` 与 `script`** |
| 把需求单里的文案放进日历候选 | 排期 agent **只引用** `creative_request_id` + 文案指纹，不自己写、不改 | 引用，不复制 |
| 事实签字（含 `worth_posting`）| **苏东坡**，签的对象是需求单的文案那一份 | 需求单；签字后冻结指纹 |
| 画面签字（首帧不撞脸、安全区、素材真实性）| **马良**，签需求单对应的成片 / 图 | 工厂成片 |
| 批准快照（巡检对照的「批准版本」）| 取自**已签字需求单的指纹**，由批准动作写入；生产方不得事后改 | v0.5 §5.1 的快照规则不变 |

- 这是对 v0.5 §3.1 / §3.3 的一处**修订**：文案作者从「排期 agent」改为「创意层」。排期 agent 的槽位、角色、时间规则全部不变。
- **过渡期（S5 上线前）**：仍是 75 号手工周包，按 v0.5 现行做法；本表从 S5 上线起生效。
- **状态：已定，S5 上线生效。** 97 号（社媒统筹）已确认采纳，不是既成事实；S5 上线前不改 v0.5 原文，现状仍按人手周包。

### 3.6 跨支柱查重：广告创意池、`copy-generator`、产品定义 §8 第 4 条
| 对照物 | 它是什么（事实）| 关系 | 结论 |
|---|---|---|---|
| `src/lib/factory/copy-generator.ts` | 工厂的文案生成（文件头写「广告文案生成，品牌接地」，读 `master_brief`，按 hook / middle / cta 三段，含 `ctaIntentFor`）| 创意层要写同样的 hook / middle / cta 文案 | **复用**：创意层调用它，不再写第二套生成器；扩的部分（首评、正文、各平台格式）加在创意需求单，不改它的现有行为 |
| 广告创意池 `src/lib/ads-strategy/creative-pool-labels.ts` 与 `plan_data.promo` | 池里只存 Meta 视频编号，靠 `content_work_orders.published_ref` 反查成片名（只读）| 广告也消费工厂成片；「有机赢家转广告」是已吸收的规则 | **以工单为共同来源**：S1 的标签写在工单上，广告侧以后可读同一组标签；广告侧目前读这些标签的调用方为零（**未验证**，S1 之后再核）|
| 产品定义 §8 第 4 条 Marketing Strategy and Asset Intelligence（「把判断转化为 Campaign、Offer、内容、创意…」）[`ME_PRODUCT_DEFINITION.md:296`] | ME 必须拥有的 Intelligence 之一，范围跨支柱 | 创意需求单是它在**社媒侧**的一个实例 | **暂不下沉**：按 tier-gate「拿不准先归低层」，留在社媒支柱内。**下沉触发条件**：广告侧或另一支柱真的开始用同一张需求单的同一批字段（hook / structure / audio / visual / text / tags），即至少两个支柱有调用方；届时再按红线 3 走晋升、子牙 + 魏征审。本稿不登记候选 |
| `viral_reference_library` | 外部样本库 | 创意层与广告创意都读 | 共读，不复制 |

---

## 4. 平台规格表（创意层的输入）

### 4.1 规则
- 只填仓库、手册、代码里能查到的事实；外部平台的数字（时长上限、字数上限、标签个数、最佳时间）**全部「待核」**，不编。
- 「发布时间」一律是**客户配置项**，不写进默认值（v0.5 §3.2）。
- 下表「ME 现状」只写接入状态，细节见第 5 节矩阵。

### 4.2 规格表（一）：形态、画幅、文字
| 维度 | Facebook | Instagram | Threads | TikTok | YouTube（Shorts） | X |
|---|---|---|---|---|---|---|
| 内容形态 | Reel；图文 Post；Story（9:16 图片）| Reels；Stories；图文（ME 里均未接）| 短帖（ME 里未接）| 竖版视频直发 | Shorts（先私享暂存，再公开）| 短帖（ME 里未接）|
| 画幅 / 时长 | Reel / Story 1080×1920；图文 4:5 或 1:1 [`social-plan-templates.ts` `PostImageFormat`]；Reel 时长上限 待核 | Reels 同 Facebook 规格 [记忆:playbook-social §二]；Stories 底部死区约 250 像素；时长上限 待核 | 待核 | 时长上限是**账号级**，由 `creator_info.max_video_post_duration_sec` 返回，不是固定值 [`post-review.ts:40`]；文件分块 5–64 MB [`tiktok-adapter.ts:19`] | 缩略图须 9:16 [`gates.ts` `thumbnail_9x16_verified`]；Shorts 时长上限 待核 | 待核 |
| 字数 | Story 文字 ≤200 字 [v0.5 §2A.4-3]；Post 正文上限 待核 | 待核 | 待核 | 文案 ≤2200 字符 [`post-review.ts:39`] | 标题、描述上限 待核 | 待核 |
| 竖版安全区（1080×1920） | 关键文字落在 y=270~1248，右侧约 120 像素留给互动栏 [记忆:playbook-social §二] | 同 | 不适用（文字为主）| 同（按 Reels 标准做，不会错）| 同 | 不适用 |
| ME 现状 | 通（见 2.3）| 断 | 无 | 半通（令牌到期，未过审只自己可见）| 半通（暂存 + 闸）| 无 |

### 4.3 规格表（二）：钩子、标签、时间、首评、禁忌
| 维度 | 平台层默认（候选）| 来源 | 平台差异 |
|---|---|---|---|
| **钩子写法（视频）** | 第一帧用文字钩子（问题 / 数字 / 反差），不用纯风景空镜；要真实粗糙感，不要精致广告感；logo 开场 + 尾卡是低分特征 | `[记忆:playbook-social §一]`，依据 `viral_reference_library` 按播放量加权 | **来源约 94% 是 YouTube**，对 Facebook / TikTok / Instagram 迁移有效性 **未验证** |
| **开场类型实际分布** | `text_overlay_question` 1059、`ugc_selfie` 430、`product_reveal` 379、`visual_shock` 229、`sound_cue` 160、`problem_statement` 141、`scenic_beauty` 137、`text_overlay_statement` 53、`testimonial_start` 23 | [查询：`opening_hook->>'type'`，共 2,623 行] | 这是「样本里出现得多」，**不等于**「效果好」；效果要用 ME 自己的标签数据验（S1 + S2）|
| **标签用法** | 待核（各平台话题标签个数、位置、是否影响分发，我没有可核来源）| — | 创意需求单里 `text.hashtags` 先留可选字段，规则待核后再写 |
| **发布时间** | 客户配置项；平台层只规定「每期每槽位最多挪 ±30 分钟、需样本门槛」| v0.5 §3.2、§7.2 | 各平台通用最佳时间 待核，不写 |
| **首评 / CTA** | 链接放首评不放正文；首评链接必带追踪参数；Reel 正文不放链接（Facebook 自然 Reel 正文链接不可点击且被压低触达）| `[记忆:playbook-social §八]` | Facebook 有首评函数；Instagram / TikTok / Threads / X / YouTube 的首评能力 **未验证**；Story 无链接贴纸（接口限制）[v0.5 §4] |
| **禁忌（平台层）** | 价格不得编；画面里可识别招牌路牌是硬证据；虚拟人物须披露；符号在同一条里不能有两个意思（钩子的 `+` 与价格页的 `+`）；复数 / 数量词回官网数一遍 | CLAUDE.md §8；`[记忆:playbook-social §二十三]`；SO-04（草案）| 平台各自的社区规范 待核 |
| **禁忌（客户层，仅例子）** | CTS：不写余位 / 早鸟 / 倒计时，3–5 月团为英文团；East Inter：全英文 | v0.5 §3.1；`[记忆:MEMORY 索引 CTS 条目]` | **不进默认值**，只在 `client_config` |

---

## 5. 脑与手之间的接口合同（草案）

### 5.1 位置与格式（给 Codex 对齐）
- **建议位置**：`src/lib/social/channel/contract.ts`（Zod schema 为准，TypeScript 类型从 schema 推导），`src/lib/social/channel/index.ts` 导出。
- **与现有的关系**：
  - 现有 `PublishAdapter`（`src/lib/factory/types.ts:270`，主干 `97df00ac7`）的 `platform` 现在只剩 `'facebook'`（#2758 已去掉 `'publer'`），只管「发一条成片」。新合同是它的**超集**：Facebook 适配器包一层即可实现新合同。
  - 「读不到≠0」的现成先例是 `fetchPostEngagement` 的 `FieldRead`（`src/lib/meta/post-engagement.ts:18`：`value | absent | omitted_unverified`），新合同沿用其语义、扩展原因码。
  - **平台列表与连接状态不新造，直接引用 Codex 已有类型**：`src/lib/platform-oauth/social-onboarding.ts` 里的 `SocialChannelStatus`（`platform: 'facebook' | 'instagram' | 'threads' | 'x' | 'tiktok' | 'youtube'`）与 `SocialAuthorization`（`not_connected | target_missing | account_mismatch | ambiguous | needs_attention | unknown | saved | refresh_pending | not_available`）。这两个类型已在主干；PR 2897 只在 `SocialChannelStatus` 上加了可选的 `connectAvailable`（2026-10-19 对 PR 2897 的 `social-onboarding.ts` 核对，**以其合并后的实际为准**）。
  - 连接行底层词表仍是 `src/lib/platform-oauth/vocabulary.ts` 的 `PLATFORM_PROVIDERS` / `CONNECTION_STATUS`（`active / revoked / expired / error`），不在合同里重复定义。
- **本稿不写实现**。下面只是名字、字段、枚举，Codex 以自己的实现为准回来改本稿。

### 5.2 接口一览（脑要什么）
| 接口名（建议）| 作用 | 脑拿它做什么 |
|---|---|---|
| `getChannelHealth(clientId, platform)` | 账号连没连好、能做哪些事 | 排期前先看；坏了开人工任务 |
| `publish(request)` | 发图文 / 视频 / Story / 短帖，可定时 | Act |
| `withdraw(request)` | 撤回 / 删除已发内容（受 v0.5 §5A 约束）| 档二调整 |
| `readPostMetrics(ref, window)` | 读单条表现，区分「读不到」与 0 | Measure |
| `readAccountMetrics(clientId, platform, window)` | 读账号级汇总 | Measure |
| `listComments(ref)` / `replyToComment(request)` | 读评论、回评论（回复受冻结约束）| 选题信号、互动 |
| `ensureFirstComment(request)` | 首评（幂等）| 链接放首评 |
| `findExisting({ target, idempotencyTag })` → `PublishedRef \| null` | 按幂等标签问平台「这条发过没」，已发返回回执、未发返回 null；返回类型与 `PublishAdapter.findExisting` 实际签名一致（`src/lib/factory/types.ts:270`）| 崩溃重来先问它，防重发 |
| `onStarted?(providerId)`（`publish` 的可选回调，与 `PublishAdapter` 一致）| 拿到平台侧编号的第一时间回调，调用方先落本地库当幂等锚 | 防重发 |
| `listRecentPosts(clientId, platform, { since, limit, cursor })` | 读回主页实际在线的已发内容，含手动发的（形状见 5.4-10）| 发后巡检 Check |
| 所有动作 | 返回 `ChannelActionReceipt` | Check |

### 5.3 核心类型与枚举（草案）
```ts
// 平台与连接状态不新造——直接引用 Codex 已有类型（src/lib/platform-oauth/social-onboarding.ts）：
import type { SocialChannelStatus, SocialAuthorization } from '@/lib/platform-oauth/social-onboarding'
export type ChannelPlatform = SocialChannelStatus['platform']   // 六平台联合类型

// ── 连接健康 ──
// 连接状态 = SocialAuthorization，九个取值全部归类（访问令牌过期 ≠ 断线）：
//   可用 / 不算断：'saved'（已保存授权，未实时核验）、'refresh_pending'（待刷新，令牌过期归此，不开人工任务）
//   需要人处理：'needs_attention'、'account_mismatch'（登记账号与授权不符）、'not_connected'（没连）、
//              'target_missing'（缺发布目标账号，需人补配置）、'ambiguous'（多个账号，需人选一个）
//   未核实：'unknown'——不当作 ok，也不开断线待办；对应能力一律按 CAPABILITY_STATE 'unverified' 对待
//   没有「手」：'not_available'（例：Threads / X）
export const CAPABILITY_STATE = [
  'available',               // 已验证可用
  'gated',                   // 代码在，被安全冻结 / 开关关着（例：首评自动、评论自动回复）
  'missing_scope',           // 缺授权范围（例：读观看数缺 read_insights）
  'unavailable_by_platform', // 平台本身不提供（例：Story 无撤回接口）
  'not_implemented',         // ME 还没接
  'unverified',              // 没验证过，不得当 available 用
] as const
export const CHANNEL_OPERATIONS = [
  'publish_text','publish_image','publish_video','publish_story','schedule',
  'withdraw','first_comment','read_post_metrics','read_account_metrics',
  'read_comments','reply_comment',
] as const
ChannelHealth = {
  channel: SocialChannelStatus,           // 直接嵌 Codex 的结构：platform / targetAccountId / authorization / identity
  client_id: string, checked_at: string, token_expires_at?: string | null,
  scopes_granted: string[], blocking_reason?: string,
  // 判定：authorization in ('saved','refresh_pending') 且令牌过期 → 待刷新，不算断；不得据此开人工任务；'unknown' → 不是 ok
  capabilities: Record<(typeof CHANNEL_OPERATIONS)[number], CAPABILITY_STATE>,
  // 公开审核状态单独一栏，不混进 authorization：例 TikTok 应用未过审 → 只自己可见
  visibility_ceiling?: 'public'|'private_only'|'unknown',
}

// ── 发布请求 ──
// 回执里的 platform 同样是 ChannelPlatform
ChannelPublishKind = 'post_text'|'post_image'|'carousel'|'video'|'story_image'|'story_video'
ChannelPublishRequest = {
  request_id: string,                        // 幂等键：同一个 id 重试不得重复发
  client_id, platform, kind: ChannelPublishKind,
  media: Array<{ url: string, sha256: string, kind: 'image'|'video', cover_url?: string }>,
  text: { title?: string, body?: string },
  first_comment?: string,
  scheduled_at?: string,                     // 空＝立即
  requested_visibility: 'public'|'private'|'draft',
  authorization: { authorization_id: string, approved_fingerprint: string } | null,  // null＝只能演练
  dry_run: boolean,                          // 默认 true；真发要同时满足开关 + 授权
  source: { calendar_candidate_id?: string, work_order_id?: string, creative_request_id?: string },
}

// ── 回执（所有动作共用外壳，见 CLAUDE.md §3 Inngest 最小要求）──
RECEIPT_OUTCOME = [
  'published','scheduled','staged_private','draft_saved','dry_run',
  'blocked',          // 本地闸拦下（无授权 / 开关关 / 指纹对不上）
  'rejected',         // 平台明确拒绝（可重试性写在 retryable）
  'rate_limited',
  'unknown_outcome',  // 结果不明：永不自动重试，先回读
  'withdrawn','withdraw_not_supported',
] as const
// 硬规则（5.4-8）：'draft_saved' / 'staged_private' / 'dry_run' 永远不能映射成工单 status='published'
ChannelActionReceipt = {
  receipt_id, request_id, client_id, platform, action: 'publish'|'withdraw'|'first_comment'|'reply'|'read',
  outcome: (typeof RECEIPT_OUTCOME)[number],
  provider_ref?: { post_id?: string, permalink?: string, publish_id?: string },
  actual_visibility?: 'public'|'private'|'unlisted'|'self_only'|'unknown',  // 实际可见级别，不得抄请求值
  retryable: boolean, error?: { code?: string, message_redacted: string },
  authorization_state: 'authorized'|'not_authorized'|'not_required',
  no_publish: boolean,                       // 演练 / 被拦＝true
  cost_impact?: { currency: string, amount: number } | null,
  created_at: string,
}

// ── 读表现：读不到≠0 ──
MetricRead =
  | { state: 'value', value: number, window: { from: string, to: string }, n?: number }
  | { state: 'not_readable',
      reason: 'missing_scope'|'platform_not_provided'|'not_yet_available'|'api_error'|'not_implemented'|'unverified',
      detail?: string }
PostMetrics = { provider_ref, platform, reads: Record<MetricName, MetricRead>, read_at: string }
MetricName = 'views'|'engaged_views'|'reach'|'likes'|'comments'|'shares'|'saves'|'watch_time'|'retention'|'replies'|'followers_gained'
// 规则：state='value' 且 value=0 才叫 0；任何读不到都是 not_readable，禁止折算成 0。
```

### 5.4 状态与硬规则（合同的「必须」）
1. **幂等**：同一 `request_id` 重试不得重发；结果不明（`unknown_outcome`）永不自动重试，先按平台回读。
2. **默认演练**：`dry_run` 默认 true；真发需要「开关 + 客户名单 + 授权记录 + 指纹一致」，沿用 Story / 图文已用的模式（v0.5 §1.2、§2A）。
3. **fail-closed**：没有授权事件和平台回执，不得伪造完成（CLAUDE.md §3）。
4. **可见级别如实**：请求 `public`、实际 `self_only`，回执写实际值（TikTok 未过审的现成例子）。
5. **读不到≠0**：同 5.3 注释；n < 5 不下结论（SO-09）。
6. **不泄漏平台细节**：平台名词、错误原文留在适配器内；回执里 `message_redacted` 必须脱敏，不带令牌和翻页链接。
7. **事件名**（Inngest，业务可读）：`social.channel.publish.requested` / `.receipted`、`social.channel.withdraw.requested` / `.receipted`、`social.channel.health.degraded`。
8. **草稿永远不是已发布**：`draft_saved`、`staged_private`、`dry_run`（以及实际可见级别不是 `public` 的回执）**不得**映射成工单的 `status = 'published'` / `video_state = 'PUBLISHED'`。只有「`outcome = 'published'` 且 `actual_visibility = 'public'`」才允许。这是 PR 2817（「Facebook 草稿不再被记成已发布」）在修的同一个问题；生产现状是近 30 天 17 张已发布工单里 14 张是草稿、3 张真公开 [查询 2026-10-19]。
9. **防重发锚点**（沿用 `PublishAdapter` 现有签名，`src/lib/factory/types.ts:270`，以现有签名为准）：
   - `findExisting({ target, idempotencyTag }) → 回执 | null`：按幂等标签问平台"这条发过没"，崩溃重来先问它，已发就返回回执、不重发。
   - `onStarted?(providerId)`：拿到平台侧编号的**第一时间**（上传 / 完成之前）回调，让调用方先把编号落本地库当幂等锚。
   - 合同里 `request_id` 对应现有的 `idempotencyTag`；`ChannelPublishRequest` 是 `publish` 入参的超集，不改这两个函数的含义。
10. **发后巡检读回主页已发内容**：`listRecentPosts(clientId, platform, { since, limit, cursor })`，返回主页上**实际在线**的条目——包含员工手动发的、来路不明的：
   ```ts
   RecentPost = { provider_ref: { post_id: string, permalink?: string }, created_at: string,
                  text_excerpt?: string, media_refs?: string[],
                  origin: 'system' | 'manual' | 'unknown',      // 能对上回执编号＝system；对不上＝unknown，不硬配
                  matched_receipt_id?: string }
   ListRecentResult = { state: 'ok', posts: RecentPost[], next_cursor?: string }
                    | { state: 'not_readable', reason: 'missing_scope'|'api_error'|'not_implemented'|'unverified' }
   ```
   「读失败」与「主页上确实没有」必须区分（v0.5 §5.3 B8 要求）；巡检只读，不得有写权限。

### 5.5 能力矩阵（现状，2026-10-19）
图例：**通** 已用且有证据；**码在** 代码在、未真发或被冻结；**在途** 有 PR 未合并；**无** 没有；**未验** 没验证。

| 操作 | Facebook | Instagram | Threads | TikTok | YouTube | X |
|---|---|---|---|---|---|---|
| 连接健康（`SocialAuthorization`）| 通：断线待办已在生产且验证；发布类 3 活跃 + 1 只读广告，另有 3 个报错（待办已覆盖）[查询] | 无连接（0 条），PR 2897 做身份接入 | 无（`not_available`）| 状态 active、同步时间为空，更像没人用；令牌到期归「待刷新」，不算断 | 1 条 legacy；令牌到期归「待刷新」，协调窗口核对 10-18 懒刷新正常 | 无（`not_available`）|
| 发图文 | 码在，从未真发 | 无（旧适配器随退役删）| 无 | 无 | — | 无 |
| 发视频（Reel / 短视频）| 通（工厂）；转公开靠人手 | 无 | — | 码在（直发；未过审仅自己可见）| 码在（私享暂存 + 公开闸；ME 回执 0 行）| — |
| 发 Story | 通（小量，图片）| Graph 层函数在（`meta/instagram-stories.ts`），调用方与授权未验 | — | — | — | — |
| 发短帖（纯文字）| 未验 | 无 | 无 | 无 | — | 无 |
| 定时发布 | 码在（`scheduled_publish_time`）[`page-posts.ts:491`] | 无 | 无 | 未验 | 未验 | 无 |
| 撤回 / 删除 | Post 码在可删；Story 平台不提供 | 无 | 无 | 未验 | 无 | 无 |
| 读单条表现 | 通：reactions / comments / shares（`FieldRead`）；观看数缺 `read_insights` | 无 | 无 | 无（只有 Apify 主页抓取）[`TikTokAdapter.ts`] | 只能读回私享视频 `readBackVideo`；分析无权限 | 无 |
| 区分「读不到」与 0 | 半通（`FieldRead` 有；账号汇总 `shares_7d` 恒 0，与回执「未核实」并存，不能当真 0）[首轮验证] | — | — | — | — | — |
| 读回主页已发内容（含手动发）| 读帖子列表函数在（`fetchPagePosts`），未包成 `listRecentPosts`；是否区分 system / manual 未验证 | 无 | 无 | 无 | 无 | 无 |
| 读评论 | 通 `fetchPostCommentsResult` | 无 | 无 | 无 | 无 | 无 |
| 回评论 | 码在，自动回复冻结 | 无 | 无 | 无 | 无 | 无 |
| 首评 | 通 `ensureFacebookFirstComment` | 未验 | 未验 | 未验 | 未验 | 无 |
| 回执 | 半通（工单 `published_ref`；Reel 的 video_state 与工单不一致）| 无 | 无 | 码在（`checkTikTokStatus`）；回执落哪张表**未验证** | 半通（`youtube_publish_receipts`，PR 2708 补写）| 无 |
| **在途 PR** | 2895（授权回调身份绑定，A）| 2897（只做身份，A）| 无 | 无 | 2905（客户自助连接，A，草稿）| 无 |

**外部平台自己的限制（例：Instagram 发布需要哪些权限与审核、Threads / X 的接口条件）：未查官方文档，全部「待核」**，不在本稿下结论。

### 5.6 回执落在哪张现有表（不新建表）
合同的 `ChannelActionReceipt` 是**外壳**，不是新表；落点按动作类型选下面四处（外加已有的 Story / Post 回执），**需要新表一律标 A 级先问 PM**。

| 回执类型 | 落点（现有）| 依据 |
|---|---|---|
| 成片（Reel / 视频）的发布结果 | `content_work_orders.published_ref`（含 `video_state`、`provisional`、`event_ids`）| `publish-worker.ts` 硬事务先落 `published_ref` + `status`；硬规则 5.4-8 约束它不得把草稿写成 `PUBLISHED` |
| YouTube 暂存 / 公开步骤 | `youtube_publish_receipts`（`ReceiptStage = staging | public_step`；`ReceiptStatus = pending | blocked | staged | dry_run_ok | published | failed`）| `src/lib/youtube-publish/store.ts:11-12` |
| 动作级记录与结果回写（做了什么、结果如何，供 Tune 读）| `flywheel_actions`（动作）与 `flywheel_outcomes`（结果）| 首轮验证 §1：`factory_reel_publish` 24 动作 / 0 结果，说明回写接线缺 |
| 发布后表现（T+4h / T+72h）| `social_post_measurement_receipts`（单条）；账号级汇总继续用 `flywheel_metrics` | 闭环登记表 ② |
| Story 发布 | `story_items.provider_receipt`（已有，不动）| 闭环登记表 ③ |
| 图文 Post 发布 | `daily_plan_auto_publish_attempts`（已有，不动）| v0.5 §2A.2 |
| TikTok 发布 | **未验证**落在哪张表（`checkTikTokStatus` 只返回状态）| 若没有落点 → 另开卡，新表为 A 级 |
| Instagram / Threads / X | 尚无「手」，不预设落点 | 随 Codex 实现再定；新表为 A 级 |

**范围提醒**：「不新建表」只对 S1–S2 成立；第 5 节合同本身不预设新表，但具体平台的回执若放不进上面几处，就是一张新表，按 A 级处理。

### 5.7 谁填、谁用
- Codex 做「手」：实现上面的接口，先 Facebook（已有零件包一层），再 YouTube、TikTok，再 Instagram，最后 Threads / X（优先级见 8.1 第 2 项，我已定）。
- 社媒 Agent 做「脑」：只依赖本合同，不 import 任何平台专用文件。
- 合同变更：由 Codex 改本稿（或改成其接口文档），社媒 Agent 窗口同步；两边都只读对方代码。

---

## 6. 分层落点与「学习→验证→写进配方→工厂模板」

### 6.1 三层落点
| 层 | 放什么 | 现在放在哪 / 应放在哪 | 不得放 |
|---|---|---|---|
| **平台层** | 框架、需求单格式、规格表、选曲与转场规则、文案结构、学习机制、硬规则（5.4）| 代码：`src/lib/social/`、`src/lib/factory/`；文档：社媒操作手册（A 级草案）| 任何客户名、客户数字、某行业判断 |
| **行业层** | 配方（开场类型权重、镜头数、切点）、角色分工、风格偏好、文案结构偏好 | 数据：`viral_reference_library`（外部样本）；文档：行业 Playbook。**目前只有旅游一个行业有镜头配方（YouTube 133 + TikTok 8 条），且都是外部样本，没有 ME 自己验证过的行业结论**（v0.5 §7.1：行业层「目前 0 个经验结论」）| 单客户事实（即使是该行业第一个客户）|
| **客户层** | VI、口吻、红线词、素材、发布时间、事实库、受众节奏（CTS 英文团、East Inter 全英文只是例子）| 配置：`master_briefs`、`client-config.ts`；客户私有记忆 | 写进共享默认值 |

### 6.2 闭环路径
```
① 外部学习（技能卡，pillar:social，state=learning）
      ↓ 对账：读 SO 规则原文（不只关键词）
② 裁决：吸收 / 部分吸收 / 忽略 / pm_decision
      ↓ 派给 97 号开交接卡（verifying + handoff）
③ 验证：用 ME 自己的数据 ——【前提：S1 标签 + S2 单条表现】
      ↓ 成立才继续；不成立 tried_failed；读不到 cannot_check
④ 写进配方：
      · 单客户成立 → 客户私有记忆（候选，不外推）
      · ≥2 个同行业客户同口径复现 → 行业 Playbook 的「配方」
      · 跨行业复现 → 平台层规则（SO-xx）
⑤ 进工厂模板：配方注册表加一个新版本（`recipe.ts` 已有 id + version 机制），旧版本保留；
      改动必须带「默认不变」证据（旧参数渲染结果不变）[记忆:playbook-social §二十二-3]
⑥ 回写：技能卡点状态 → adopted，`rule` 填 SO 编号，规则行写来源卡文件名
```

### 6.3 与现有技能卡机制的接线点（逐个，含现状）
| 接线点 | 现有 | 现状问题 | 本稿动作 |
|---|---|---|---|
| 机器索引 `pillar` 字段 | README 已支持可选 `"pillar":"social"` | 学习库页面代码是否已按支柱切换：以 PR 2869 为准，**未验证** | 不动 |
| 规则手册 | 社媒手册 v1.0 是 A 级草案，**未批准** | `adopted` 需要 `rule` 指向手册编号 → 手册未生效前社媒点不可能 `adopted` | S9：PM 批准手册后，才能把验证成立的点写入；本稿不替它批 |
| 规则摘要 | `ME-SOCIAL-RULES-DIGEST.md` 12 条 SO | 无 | 复用 |
| 交接卡 | 9 张学习卡有交接卡 `…social-learning-handoff-97` | 全部 `cannot_check`，因缺数据 | S1、S2 补数据后复验（触发条件见首轮验证 §6）|
| 验证数据 | 页面级汇总 + 4 行回执 | 分不了组 | S1（标签）、S2（单条表现）|
| 行业层配方 | `viral_reference_library` | 只有外部样本，没有「ME 自己验证过」的标记 | 暂不加表 / 列；验证结论先写在行业 Playbook 文档与台账，需要列时再按 A 级提 |

外部做法一律是候选（SO-02），只有 6.2 的 ③ 通过才升层；本稿不新增任何一条已采纳规则。

---

## 7. 开发顺序：最小可交付切片

**通用约定**：写入者默认 DeepSeek（Claude Code 出指令、审 diff、跑测试 / 建 PR）；A 级安全核心可由 Claude Code / Codex 自写并在 PR 写明原因（CLAUDE.md §5）；新表一律标 A 级先问 PM；开工前先核主干是否已有人做。**「不新建表」只对 S1–S2 成立，别外推到后面的片。**

**闭环对照**：`2026-10-18-me-closed-loop-skeleton-min-cost.md`「社媒」行只有两个断点——**①发布最后一步**（总开关没开→草稿→人工转公开，回执不回写）、**②发布后表现回写计划**。每片必须对到其中之一；对不上的标「按冻结令推迟」，不进第一批。

| 片 | 做什么 | 复用什么 | 风险 | 新表 | 谁写 | 依赖 Codex | 验收 | 对到的断点 | 排期 |
|---|---|---|---|---|---|---|---|---|---|
| **S1** 创意标签 | 给 `content_work_orders.brief` 加一组可选键 `creative_tags`（开场类型、栏目、选题来源、BGM、平台）。**Story 条目与图文周包条目暂不加列**（加列＝迁移＝A 级，另开卡）。建单时由**建单方**填（S5 之前＝97 号 / 106 号建单窗口按已有的 `viral_style_directive`、`creative_recipe` 推出；S5 之后＝创意层）| 现有 `brief` jsonb；`recipe.ts` 的 `assertRecipeBriefComplete`——**第一步先验：新增可选键不会让现有校验失败** | B | **否** | DeepSeek | 无 | 新建工单中带齐标签的比例 = 100%（查库）；旧工单读取不报错；共享代码 grep 不到客户名 | **② 回写**（让表现能挂到「是哪种开头」上；**标签是自报，不是实测**）| **第一批** |
| **S2** 单条表现读取 | 只读函数：给定客户 + 窗口，列最近 N 条已发内容的表现，每个数字带 `value` 或 `not_readable(原因)` + 样本量。**S5 之前由 97 号人工读它的输出，用在人手周包排期**（现在排期是人手周包，没有程序读它）；S5 之后才由创意层 / 排期程序读。**先做 Story 与图文 Post 部分，Reel 部分等 S7** | 读现有表 `social_post_measurement_receipts`、`flywheel_metrics`；沿用 `FieldRead`；不新增表 | B | 否 | DeepSeek | 无（读现有表）| 对生产库只读试跑：CTS 的输出里「读不到」与「0」分开显示、n 标明；单测覆盖 0 与读不到不混；**试跑窗口里必须有至少 1 个有真实数据的窗口（真有单条回执 / 汇总值）**，否则验收记「管道先铺、无数据可验」，不得写成「已验证」 | **② 回写** | **第一批** |
| S3 平台规格表常量 | 把第 4 节落成 `src/lib/social/platform-specs.ts` | 第 4 节 | B（纯数据）| 否 | DeepSeek | 无 | — | **对不上两个断点** | **按冻结令推迟：按调用方出现再做**。原计划为 Instagram / Threads / X 先做空格子——没有调用方，取消。第 4 节文档表继续当参考 |
| S4 合同类型文件 | 把第 5 节写成 Zod + 类型，不含实现 | `SocialChannelStatus`、`FieldRead` | B | 否 | **Codex 在自己的适配器 PR 里落**，本稿只当参考 | 是 | — | 部分对 ①（`draft ≠ published` 硬规则）；但该规则的修复已在 PR 2817 / 转公开卡 | **按冻结令推迟**：不单独开类型 PR；Codex 做 Facebook 包装时顺带落 |
| S5 创意层工作流 | 规则手册 + 例行任务（先文档后代码）：接槽位 → 三层上下文 → 配方对账表 → 需求单；并接入「连接状态」（读 `SocialChannelStatus`）| 配方库、`copy-generator`、`shot-recipes`、`price-fact-gate` | B | 否 | DeepSeek + 苏东坡 / 马良审 | 无 | 对 1 个客户当场试跑，输出需求单 + 配方对账表 | **对不上两个断点**（它是新增的「想」）| **按冻结令推迟**：先有 S1 标签与 S2 数据，创意层的产出才能被验证 |
| ~~S6~~ 连接健康进待办 | **已删除**：连接断线待办已在生产且验证（见 2.1 #1）。缺的「把状态喂给脑」并入 S5 | — | — | — | — | — | — | — | 已删 |
| S7 Reel 按条转公开并回写 | **不是本稿的活**，已在闭环登记表立卡（A 级，97 号 / 74 号）| `promoteReelToPublished` | **A** | 否（登记表称不需要）| 其他窗口 | — | 见该卡 | **① 发布最后一步** | 他人进行；S2 的 Reel 部分等它 |
| S8 学习复验 + 手册生效 | PM 批准社媒手册后，用 S1 + S2 的数据重跑 9 张卡 | 技能卡全套 | C（文档）/ 手册为 A | 否 | 120 号 / 97 号 | 无 | 复验记录 | ② 的下游 | S1、S2 有数据后 |

**第一批：S1 + S2（两片，不新建表，不碰发布路径，可并行）。** v0.1 把 S3 也放第一批，已撤回：规格表没有调用方，也对不上两个断点。

**坦白：做完 S1 + S2，9 张学习卡很可能仍是 `cannot_check`**（首轮验证 §2 的 8 个 `cannot_check`）。原因有四：
1. **Facebook 缺 `read_insights`**，观看数 / 触达读不到（v0.5 §6）；我们不为此改授权范围（改范围会静默断开现有连接），所以"哪种开头留存更好"这类问题在 Facebook 上本来就验不了，只能用点赞 / 评论 / 分享（且 Reel 的分享字段平台不一定返回）。
2. **样本凑不够**：Reel 每周约 3 条、图文每天 2 条（还没真发），按 SO-09「每组 n ≥ 5」，分到一个开场类型下要数周。
3. **S1 的标签是自报，不是实测**：建单方（先是人 / 窗口，后是创意层）填的开场类型，与实际视频是否一致没人独立核；要等苏东坡 / 马良审时顺带核标签，才算可信。
4. **三个平台根本没数据**：Instagram、TikTok、Threads、YouTube 分析在 ME 里没有读取，涉及这些平台的 5 张卡不会因 S1 / S2 而变化。
所以 S1 + S2 的价值是**先铺管道、让数据开始积累**，不是马上出验证结论；S8 复验的触发条件仍按首轮验证 §6。

**不能抢跑的顺序**：S7 先于 S2 的 Reel 部分；S8 先于任何「采纳规则」；S5 先于 3.5 表生效。

## 8. 明确不做 与 PM 待拍板项

### 8.1 本稿与首批切片明确不做
- 不新增能力线、支柱、第二套学习库；第一批 S1、S2 不新建数据表（后面的片若要新表，按 A 级另报）；
- 不写代码、不改库、不新增页面（团队冻结令；本稿 C 级）；
- 不解冻 v0.5 §1.5 的冻结项（首评自动、评论自动回复、AI 文案自动发出）；
- 不改任何授权范围、不申请 `read_insights` 或 YouTube 分析权限（改范围会静默断开现有连接）；
- 不接 Threads / X / Instagram 发布（合同只列形状）；
- 不用外部平台的数字当规则（全部「待核」）；
- 不让创意层调用生图 / 生视频接口或发布接口；
- 不把 CTS、East Inter 等客户规则写进默认值；
- 不用「平台热门音乐」（商用授权未核；只用已授权曲库）；
- 不把本稿的 SO 规则当已采纳——社媒手册仍是 A 级草案。

### 8.2 决定归属：我定的 / 必须 PM 本人回的 / 一次问一个的

**A. 技术决定，我已在稿里定了（不上抛 PM）**
| # | 事项 | 定 |
|---|---|---|
| 1 | 创意层要不要起**能力名** | **不起**。叫「社媒支柱下的内容创意」；归位既有 L1，不新增能力线 |
| 2 | 六个平台的**接入优先级** | Facebook → YouTube → TikTok → Instagram → Threads / X（依据：Facebook 已通；YouTube 已有 Shorts 在发；TikTok 要先过审；Instagram 只有身份接入；Threads / X 零实现）|
| 3 | 文案作者归谁 | 创意层（3.5）；97 号已确认采纳，S5 上线生效 |
| 4 | 回执落点 | 5.6 的现有表，不新建 |

**B. 授权范围，A 级，必须等 PM 本人回；我不替你默认，未回前一律不动**
| # | 事项 | 我的建议（仅供你参考，不是默认）| 为什么必须你本人 |
|---|---|---|---|
| 5 | **YouTube 分析权限**（看 Shorts 的 Views 与 Engaged views）| 建议暂不申请 | 改授权范围；有静默断开现有连接的前科（记忆 `feedback-changing-oauth-scope-silently-kills-live-connections`），需单独立项（含重新授权和回归验证）|
| 6 | **Instagram 发布权限**与 Meta 应用审核 | 建议先只做身份接入（PR 2897），发布另议 | 涉及外部平台审核和账号资格；10-05 的盘点稿称当时 Meta 有一次审核在进行、期间不宜再提交（`2026-10-05-publer-retirement…` §一-4），现状**未验证** |

**C. 业务问题，点头之后我一次问一个**
- **第一个问题：Threads 和 X 做不做？** 回 `做` 或 `不做`。我的建议是 `不做`（目前 0 个客户在用，学习卡里 Threads 只是候选）；未回前保持不做、不开工。
- 答完再问**第二个：背景音乐曲库范围**。选项只有两个：回 `只用已授权` 或 `可加平台热门音乐`；我建议前者（后者商用授权未核）。

另有一条不需要你定、但请知悉：**S2 的 Reel 部分要等 S7（Reel 转公开）**，那是 A 级、别的窗口在做；先做 Story 与图文部分，不阻塞。

### 8.3 我没验证到的
- 六个平台官方接口的能力与限制（时长 / 字数 / 标签 / 最佳时间 / 权限与审核条件）：**没有查外部文档，全部待核**；
- TikTok、YouTube 令牌能否自动刷新（库里只有访问令牌到期时间）；
- Render 上各发布开关的真实值（只能从运行记录反推）；
- `connection-health.ts` 的心跳是否覆盖 TikTok / YouTube；
- 学习库页面（PR 2865 / 2869）是否已上线并按支柱切换；
- Supadata 钥匙是否有效（学习 spec §1.1 也标了未核实）；
- PR 1913（单条 Reel 观看数日同步）是否仍可用（首轮验证标「待核」）；
- 「新增可选键不会让 `assertRecipeBriefComplete` 失败」——**只是预期，S1 开工第一步必须先验**；
- 配方库样本（约 94% YouTube、5% 小红书）对澳新受众与 Facebook 短视频的适用性；
- 在途 PR 2895 / 2897 / 2905 的合并状态以本稿日期的 `gh pr list` 为准，之后会变；
- 冻结令原文（见 1.1）；
- TikTok 令牌能否真正续期：`tiktok/token.ts` 与 `HEARTBEAT_POLICY` 口径不一致；
- TikTok 回执落哪张表；
- 广告侧是否已有读工单标签的调用方（S1 后核）；
- 近 30 天 17 张已发布工单里 14 张草稿 / 3 张真公开，按 `published_ref.video_state` 统计；全历史 21 张里 `video_state` 为空的 3 张未归类。

---

## 9. Reuse Statement

- **复用了什么已有平台能力**：社媒支柱；视频工厂（配方、模板、对账、分镜自检）；`viral_reference_library`；`content-review` 与价格闸；`copy-generator`；`connection-health`；`platform-oauth` 连接存储；Facebook 发布 / 读取函数；`FieldRead` 语义；技能卡与台账机制；v0.5 全部设计。
- **新增内容哪些是真正 platform-shared**：创意需求单格式与标签词表、平台规格表结构、脑手接口合同（`ChannelHealth` / `ChannelPublishRequest` / `ChannelActionReceipt` / `MetricRead`）、「读不到≠0」硬规则、学习闭环路径。
- **哪些是 industry-specific**：开场类型权重、配方（如旅游行业的镜头配方）、角色分工——均标候选，且样本以 YouTube 为主。
- **哪些是 client-specific**：CTS 英文团、不写倒计时、East Inter 全英文、发布时间——只作例子，在客户层。
- **有没有把客户名、客户 ID、行业判断或私有事实写进 shared runtime**：本稿是文档，没有代码；切片验收里写了「共享代码 grep 不到客户名」。第 4 节的客户例子只出现在标注「客户层，仅例子」的行。
- **学习去向**：全部仍在候选；单客户证据只进客户私有记忆；本稿不升级任何一条到行业或全局。
- **与 tier-gate 对账行**：本次落点（文档，社媒支柱下的执行形态 + L3 连接器）与 tier-gate 决策时的分类**一致**；无差异。v0.2 新增的跨支柱查重（3.6）结论为复用、暂不下沉，同样与分类一致。

## 10. 审查状态
- v0.1：起草稿，2026-10-19 经子牙（架构）+ 魏征（挑刺）审，结论均为「需改」。
- v0.2：并入必改项后，经子牙 + 魏征复审（11 条必改：闭合 8 条、部分闭合 3 条）；结论：可修后给 PM 点头。
- **v0.3（本版）**：复审必修后的版本，改动见文首。按 CLAUDE.md 第 4 条，触及「新增对外接口合同」属大任务；PM 点头后、动手前再审一次；S1、S2 实施另按 B 级走一次集中 review。

---

## 附录. 生产库只读查询摘要（2026-10-19，SELECT）
| 查询 | 结果 |
|---|---|
| `viral_reference_library` 行业 × 平台 | YouTube：beauty 571、fashion 558、travel 548、tech 548、fitness 477、real_estate 392、flooring 322、food 311；小红书：ai_education 99、digital_marketing 96；Facebook：travel 11、flooring 3（客户私有）；TikTok：travel 8；upload：travel 1。**Instagram / Threads / X：0 行** |
| 其中 `opening_hook` 非空 / `shot_recipe` 非空 | 开场钩子 2,623 行；镜头配方 141 行（travel YouTube 133 + travel TikTok 8；其中 2 行带 `error`，139 行有效）|
| 已发布工单（`content_work_orders`，`status='published'`）| 全历史 21 张：`video_state` DRAFT 14、PUBLISHED 4、空 3；**近 30 天 17 张：DRAFT 14、PUBLISHED 3**（2026-10-19 查询）|
| `story_items` | 54 条：SENT 11、PENDING 36、BLOCKED 5、MISSED 2；`last_check_result` 非空 2（均 MISSED）|
| `opening_hook` 键 | 全部为 `script` / `feel` / `type` 三键 |
| `shot_recipe` 键 | `rhythm`、`shot_count`、`cut_times`、`duration_seconds`、`hook`、`shots`、`measured_with`（139）；2 行带 `error` |
| `content_work_orders.brief` 键（123 行）| `copy` 119、`engine` 93、`remotion` 93、`segments` 30、`viral_style_directive` 15、`creative_profile` 8、`creative_recipe` 4 …；**无** 开场类型 / 栏目 / 选题来源 / BGM 标签键 |
| `platform_oauth_connections`（meta / tiktok / google_youtube）| meta：legacy active 3、legacy error 3、meta_ads_read active 1；tiktok：legacy active 1（令牌到期 10-14）；google_youtube：legacy active 1（令牌到期 10-18）。未读任何令牌内容 |
