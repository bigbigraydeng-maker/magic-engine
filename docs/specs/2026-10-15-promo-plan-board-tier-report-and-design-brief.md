# 「推广计划板块」层级报告 + 设计任务书（只是提案，没写代码）· 105 号 · 2026-10-15

PM 10-15 指示：广告计划和社媒动态计划不能再放在对话框里做，要做成 ME 后台的一个工具板块，用代码来控制。
理由（PM）：一是对话里没有上下文，二是不严谨。

## 先说现状：大半个地基已经有了，不从零造

| 要的能力 | 已有 | 位置 |
|---|---|---|
| 每日/每月上限、设定值 | 广告策略配置 | `ad_strategy_configs`、`src/lib/ads-strategy/config.ts` |
| 目标与进度 | 目标/行动表、目标节奏 | `goals`、`initiatives`、`src/lib/ads-strategy/goal-pace.ts` |
| 开投前预算余量检查 | 发布前预算余量 | `launch-budget-headroom.ts` |
| 草稿 + 闸 + 红线词 | 草稿闸、红线 | `draft-and-gate.ts`、`draft-redlines.ts` |
| 素材池与审批 | 素材池标签 | `creative-pool-labels.ts` |
| 人工批准、外发授权、全程留痕 | Kernel | `src/lib/kernel/`（`human-approval`、`outward-authorization`、`lineage`）、`authorization_decisions`、`kernel_action_lineage` |
| 订位、线索、归因 | CRM | `crm_bookings`、`contact_touchpoints`、`ad_daily_insights` |
| 每日自检/体检 | 摘要、体检 | `ads-strategy/digest.ts` 等 |

**缺的只有一层**：把「计划」本身变成系统里的数据（目标、分阶段步骤、每步的开投条件和当前是否满足），并给一个看板。

## Platform Tier Classification（Full）

**被判定对象**：「推广计划板块」——每个客户一份推广计划，分阶段，每步有开投条件（闸），闸的状态由系统读真实数据算出来，不由人在对话里宣称；每步的批准、执行、验证全留痕。

**建议层级**：
- 计划模型 + 阶段与闸的状态机 + 看板 → **L1 平台基础设施（Governance / Growth Contract）**，建在已有的 ads-strategy 与 Kernel 之上。
- 「旅游行业的闸项」（班期核实、销售窗口说法）→ **L2 行业 Playbook**。
- 「CTS 的团、金额、人数口径、主推顺序」→ **L4 客户配置**。

**换客户测试**：骨架 ✓。换成 NAL（物流）：目标=询盘/线路，闸项=官网有该线路、对客红线闸有效、预算上限；骨架不用改，只换配置。CTS 的「Discovery 18/Signature 12」「主推顺序」只能是配置。
**换行业测试**：骨架 ✓，闸的细项 ✗（旅游查班期，物流查线路），下沉到 L2。

**智能层 or 执行手**：治理与验证（智能层）。不直接操作广告账户；任何动账户的动作仍走 Kernel 的人工批准和外发授权。

**红线检查**：1（不新设能力线）✓，是已有 Growth/Governance 的扩展；2（客户事实不进共享代码）✓ 要求；3（单客户不直建 L1）⚠ 证据只有 CTS，但是**补强已有 L1 能力**，不新建能力线，建议先 CTS 一家跑通、第二个客户（NAL）验证骨架；4/5 ✓；6 若建，走五道 Build Gate；7 ✓。
**PM 待拍板**：无商业决策；是否解冻新功能（PM 已暂停新功能，本项由 PM 本人提出，视为对本项解冻，请 18 号确认）。

**结论**：不是新能力线，是在 ads-strategy + Kernel 上加「计划与闸」一层 + 看板。登记为 L1 候选前，先做 CTS 一家。

## 第一版范围（建议，先小后大，先读后写）

**v1：计划 + 看板 + 闸门读数，只读，不动任何账户**
1. 计划数据：目标、阶段、每步的受众/预算/素材/开投条件，版本化（每次改有记录，对话里没有的上下文在这里）。
2. 看板：每一步一张卡，显示**由系统读出来的数**——设定预算 vs 上限（读 `ad_strategy_configs`）、昨天花费（读 `ad_daily_insights`）、Meta 表单触点、各团订位数（读 `crm_bookings`）、各团还差多少、受众人数、闸项是否满足（绿/黄/红 + 数据来源 + 读取时间）。
3. 闸项由代码算：账户状态、素材池是否已批准、红线词扫描、价格是否与官网一致、预算余量、中文内容闸、对账口径是否定。**算不出来的显示「未知」，不显示绿。**
4. 数据口径固定：一个团的「还差多少位」=容量（配置）−有效订位（CRM），不再靠对话里转述的名单。

**v2：审批与执行接 Kernel**：每一步「开/加钱/停」走 Kernel 的人工批准与外发授权，批准钉版本；执行结果读回写入看板；到期自动出提醒。
**v3：社媒动态计划同一板块**：每周主推团↔广告在做什么，周包与发布状态读系统数据。

## 设计任务书（要 18 号指派一个开发窗口，A 级：新表）

- 做什么：v1 的数据模型（尽量复用 `goals`/`initiatives`/`ad_strategy_configs`，新增只在复用不够时）、读数适配、看板页面、闸项清单（平台默认 + 旅游行业叠加 + CTS 配置）。
- 约束：全程只读；不写代码前先出设计；走子牙+魏征两审，面向客户端的部分加板桥；上线要 PM 回「合 N」；计划里的数字（187、6,250、容量 18/12、主推顺序）全部是 CTS 配置，不得写进共享代码。
- 验：CTS 的一份真实计划能在看板里完整显示，每个数能追到来源表和读取时间；故意把一个闸项（如素材未批准）弄红，看板显示红且给出原因。
- 当场试跑：看板是页面，不是自动任务；若加每日读数任务，按「当场试跑」规则手动触发一次并记录。
- 复用声明：复用 ads-strategy、Kernel、CRM 订位与归因；新增的只是计划与闸的数据层和看板。

## 在此之前

两份一页纸（`2026-10-15-cts-ads-plan-onepager.md`、`...-social-plan-onepager.md`）是**过渡期的权威来源**，进了板块后以板块为准，文档只留历史。

---

# 补充（PM 10-15 第二条指示）：三层逻辑与和现有 Marketing Plan / 每日计划的合并

PM 原话三条：①**计划审批**：先有计划，计划什么也不要做；审批同意后再去生成内容。②**代码合并**：调整现有 Marketing Plan 和 Go 的功能，看代码怎么合并。③**执行落地**：最终生成每日计划，借视频工厂、Blog、Newsletter 统一干活。

## 一、现状（2026-10-15 只读查实，不是回忆）

| 已有 | 在哪 | 状态 |
|---|---|---|
| Marketing Plan（计划层） | `marketing_plans` 表、`src/lib/marketing-plan/{types,generator,task-dispatcher}.ts`、`/dashboard/clients/[id]/marketing-plan` | **已有审批状态机**：draft → approved → completed → archived；**批准时才派任务**（`task-dispatcher.ts` 把 `plan_data.tasks` 写进 `execution_items`）。但库里最后一条 approved 是 2026-08-20，**近两个月没人用** |
| 计划内容维度 | `types.ts` | 已含 social（每周帖子/每月 Reels/每周 Story）、blog（月度篇数+主题）、email（newsletter 主题与节奏）、kpis、tasks |
| 每日计划（执行层） | `campaign_daily_plan` 路由族、`/dashboard/clients/[id]/daily-plan` | 在用；含发布队列、自动发布与授权（`daily_plan_auto_publish_auth/attempts`）、复盘 |
| 广告层 | `ad_strategy_configs`、`src/lib/ads-strategy/*`、Kernel 授权与留痕 | 在用，但**和 Marketing Plan 不相连**：计划里没有广告维度 |
| 活动简报 | `campaign_briefs` | 在用 |

**所以不是从零建，是三件事**：①Marketing Plan 加「广告维度 + 分阶段 + 闸」；②把它和每日计划接起来（批准的计划→每日计划→工厂/Blog/Newsletter）；③把广告的执行与留痕挂到同一条链上。

## 二、PM 三层对应到代码（设计任务书的真正内容）

**第 1 层 计划审批（先计划，不做事）**
- 复用 `marketing_plans` 的状态机，**不新建一套**。
- 扩 `plan_data`：加 `ads`（分阶段：每步受众、预算、素材、开投条件）与 `gates`（闸项清单）；社媒维度已有，补「主推团/主推主题轮换」。
- **硬约束**：`status != 'approved'` 时，**不得派任何任务、不得建任何草稿、不得生成内容**。现在 dispatcher 已是「批准才派」，要把这条扩到广告与内容生成的所有入口（逐个调用点加判断，不是写在文档里）。
- 批准要钉版本（批准的是哪一版 plan_data 的哈希），之后改动要重新批准。

**第 2 层 代码合并（Marketing Plan × 每日计划 × 广告）**
- `marketing_plans.plan_data.tasks` → `execution_items`（已有）→ **每日计划按日取任务**（现在两边各走各的，要接）。
- 广告阶段表不另起炉灶：阶段的「开投」动作走 Kernel 的人工批准与外发授权（`human-approval`、`outward-authorization`、`lineage`），预算上限仍读 `ad_strategy_configs`。
- 闸项由代码算（账户状态、素材池已批准、红线词、价格与官网一致、预算余量、中文内容闸、订位数），**算不出的显示「未知」，不显示绿**。
- 要先回答的合并问题（交给开发窗口调查后给结论，别猜）：现有 `execution_items` 与每日计划是否同一套任务模型？`campaign_briefs` 与 `initiatives/goals` 谁是目标的真相源？Marketing Plan 近两个月无人用，是功能不好用还是流程绕过去了？

**第 3 层 执行落地（每日计划 → 三个工厂）**
- 每日计划是唯一出口：社媒（视频工厂出 Reel、图文、Story）、Blog、Newsletter。
- 每条产出带 plan_id 与 task_id，发布回执写回，看板显示「计划 N 条 / 已产出 M 条 / 已发布 K 条」。
- 发布、扣费、对客外发仍 fail-closed：没有批准事件和回执不许算完成。

## 三、分期（建议）

- **D1 调查与设计**（不写代码）：现状调查（上面三个合并问题）+ 数据模型与闸项清单 + 页面草图；两审（子牙、魏征）+ 板桥（面向客户端）。
- **D2 v1 只读看板**：计划里的广告阶段与闸项状态，数据全部读现有表；不动账户。
- **D3 批准链**：批准钉版本；未批准不得生成内容（逐个调用点）。
- **D4 接每日计划与三个工厂**：任务流转与回执。

**风险级**：A（新表/改批准链/碰外发）。上线要 PM 回「合 N」。
