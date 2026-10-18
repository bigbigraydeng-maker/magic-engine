# 推广计划板：经营判断卡 / 实验设计卡 / 素材需求单 / 销售承接闸 · 设计稿 v0.1

- 日期：2026-10-18 · 窗口：105 · **只是设计稿，没写一行代码、没动库**
- 来源：PM 10-18 认可的「广告标准流程 v2」；统筹 10-18 指派。
- 现状是查实的，不是回忆：读了 `src/lib/marketing-plan/promo/{spec,gates,playbooks,budget-caps,content-hash}.ts`、
  批准接口 `…/marketing-plan/[planId]/approve/route.ts`、保存接口 `…/promo/route.ts`，以及生产库 `execution_items`、`ad_strategy_configs` 的列。

---

## 0. 一句话结论

**四样东西里，三样不用建新表**：经营判断卡、实验设计卡、销售承接闸都可以放进计划自己的 JSON（`marketing_plans.plan_data.promo`），
跟着已有的「结构校验 + 内容指纹 + 批准快照」一起走；**只有素材需求单的任务落地要用已有的 `execution_items`**，也不用新表。
**真正要新增的只有：3 个检查项（闸）、1 个 schema 版本、几段页面。没有 migration，就没有 A 级的新表。**

---

## 1. 先说清楚地基已经有什么（不要重造）

| 已有 | 在哪 | 这次怎么用 |
|---|---|---|
| 计划结构与跨字段校验（阶段不重叠、步骤日期落在阶段内） | `promo/spec.ts`（zod + `crossFieldIssues`） | 新卡片加进同一个 schema，**保存时一起校验**，畸形一律 `ok:false`（fail-closed 已有） |
| 检查清单（闸）：封闭词表 + 硬门/软门 + 四色灯 | `promo/gates.ts`（`GATE_KEYS`、`MANUAL_GATE_KEYS`、`evaluateApproval`） | 新增 3 个 key，**硬门**；灰（读不到）一律不算绿 |
| **批准处服务端 fail-closed** | `approve/route.ts`：`evaluateApproval` 不过 → 409，**连状态都不改** | 新闸自动获得同样的拦截力，不用另写拦截 |
| 批准钉版本 | `promo/content-hash.ts` + `ApprovalReceipt.gate_snapshot` | **把新卡片纳入指纹**：批准的是哪一版经营判断，事后可证 |
| 人工核实项（读不到的事实） | `MANUAL_GATE_KEYS` + `/promo/verify` 写 `generation_meta` | 销售承接、落地页这类人说了算的事走同一条路 |
| 阈值与节奏（平台/行业层） | `promo/playbooks.ts`（目前只有 default，每项标 `evidence`） | **只放「要不要填、几条、几天」这类规则**，不放客户数字 |
| 批准后派任务 | `marketing-plan/task-dispatcher.ts` → `execution_items` | 素材缺口变成任务走这里，字段已有 `title/description/due_date/assigned_to/status/source/marketing_plan_id/dimension/fix_type` |

**客户数字放哪**：20%/10% 留存、每单约 1.74 人、各团剩余座位，**全部填在计划自己的经营判断卡里**（属客户数据，随计划走），
不进 `playbooks.ts`、不进任何共享常量、不新建客户配置表。行业层只出现「必须填哪些字段、哪些要标未确认」这类规则。

---

## 2. 四样东西各自的设计

### 2.1 经营判断卡（每笔广告预算一张）

**放哪**：`plan_data.promo.phases[].business_case`（阶段级；一个阶段里多个广告步骤共用一张，因为预算是按阶段定的）。
**字段**（全部必填，除非标可空）：

| 字段 | 含义 | 备注 |
|---|---|---|
| `departure_ref` | 目标团期 | 填 `tour_catalog_departures.id` 或人能看懂的「团名 + 出发日」；**不校验存在性**（班期不一定在 ME 里） |
| `seats_remaining` | 剩余座位 | 数字 |
| `seats_confirmed` | 这个数是不是客户确认过的 | **false → 闸判灰 → 硬门不过**（对应 PM「待 CTS 确认的要标」） |
| `seats_as_of` | 这个数什么时候取的 | 超过剧本的新鲜度天数 → 灰 |
| `retained_per_seat_cents` | 每座公司留存 | 客户数字，填在卡里 |
| `retention_basis` | 这个留存**扣掉了什么** | 封闭枚举多选：`commission` / `ad_cost` / `fixed_cost`；**必须至少勾一项或显式勾「都没扣」**，否则闸不过 |
| `pax_per_booking` | 每单人数 | 客户数字（CTS 约 1.74） |
| `lead_to_booking_rate` | 线索→预订成交率 | 小数 |
| `rate_source` | 成交率从哪来 | 枚举：`measured`（有样本，填 `rate_sample_n`）/ `assumed`（**假设 → 闸判黄，不拦，但批准时写明**） |
| `creative_gap_note` | 素材缺口 | 可空；素材需求单会自动算，这里只放人补充的 |
| `owner` | 负责人 | 一个人名/邮箱 |

**算出来的（不存，页面与回执里算并显示公式）**：
- 可承受线索成本 = `retained_per_seat_cents ÷ pax_per_booking × lead_to_booking_rate`
  （一条线索带来的留存期望值；按 PM 的口径「每座留存 × 每单人数 × 成交率」会把单位算错 —— **每座留存已经是「一座」的钱，一单有 1.74 座，所以每单留存 = 每座留存 × 1.74，再乘成交率才是每条线索的价值**。
  两种写法差 3 倍，**请 PM 拍一下用哪个**：①每条线索价值 = 每座留存 × 每单座数 × 成交率；②每条线索价值 = 每座留存 × 成交率。我按①实现，并在页面上把式子写出来给人看。）
- 保本所需最低成交率 = `实际每条线索成本 ÷ (retained_per_seat_cents × pax_per_booking)`；实际线索成本读 `ad_daily_insights`，读不到 → 显示「未知」，不显示绿。

**闸**：新 key `ads.business_case`（硬门，组 `tool`）。
红：没有卡、必填项缺、`retention_basis` 没勾。灰：`seats_confirmed=false` 或 `seats_as_of` 过期。黄：`rate_source='assumed'`。绿：都齐。
**服务端**：保存时校验结构（zod）；批准时 `evaluateApproval` 拦（硬门红/灰 → 409）。

### 2.2 实验设计卡

**放哪**：`plan_data.promo.phases[].experiment`（可空）。
**字段**：`hypothesis`（验证什么）、`held_constant`（固定什么，字符串数组）、`primary_metric`（封闭枚举 `enquiry` / `qualified_enquiry` / `booking`）、`max_loss_cents`（最大损失）、`stop_rule`、`continue_rule`、`owner`。
**闸**：新 key `ads.experiment_defined`。
**不是所有阶段都要做实验**，所以：阶段上加 `is_experiment: boolean`；
- `is_experiment=true` 且卡缺/不全 → **硬门红**；
- `is_experiment=false` → 该阶段这项显示「不适用」，不参与判定。
**额外一条服务端校验**（保存时就拦，不等到批准）：`max_loss_cents` 不得小于该阶段广告日预算合计 × 阶段天数的 **1/10**，也不得大于其总额——
前者防「写个 1 块钱当免责」，后者防「最大损失比总预算还大」等于没设。阈值 1/10 放剧本，不写死。

### 2.3 素材需求单（自动生成 + 缺口变任务）

**不新建存储**。两段：
1. **算需求**：纯函数 `creativeNeeds(spec, playbook)` → 每阶段每个广告步骤需要几条、什么角度。
   数量与角度词表放 `playbooks.ts`（平台/行业层，目前只能是 `unvalidated_default`，**不要替旅游写数字**）。
   角度建议封闭枚举：`price_reveal` / `story` / `real_footage` / `itinerary`（对应已在用的「价格悬念 / 故事 / 实拍 / 行程」）。
2. **对已有素材**：读 `ad_strategy_configs.creative_pool`（已在 `GateFacts.config.creative_pool`，status 只有 `candidate|approved`），
   **只认 `approved`**；差额 = 缺口。
3. **缺口变任务**：批准时由已有的 `task-dispatcher` 一起派进 `execution_items`，
   `source='marketing_plan'`、`marketing_plan_id`、`dimension='social'`、`fix_type='fde_manual'`、`title/description/due_date/assigned_to` 按缺口填。
   **到期日**：该阶段开始日往前推 N 天（N 放剧本）。
   **验收**：描述里写死「走视频工厂、过苏东坡/马良、首帧不得含占位价」——这几条是已有规矩，不新造。
**闸**：复用已有的 `ads.creative_approved`（已是硬门），不新增 key；页面上把「缺几条、缺什么角度」显示出来，让人知道为什么红。
**这一块是页面提示 + 批准后派任务，不新增拦截**。

### 2.4 销售承接就绪闸

**放哪**：`plan_data.promo.sales_handover`（计划级，不是阶段级）：`owner`、`response_sla_hours`、`fallback`（没人接手怎么办）、`channel`（封闭枚举 `phone|email|dm`，多选）。
**闸**：新 key `sales.handover_ready`，**硬门**，并且是**人工核实项**（进 `MANUAL_GATE_KEYS`）——
因为「真有人在接、几小时内回」系统读不到；填了字段只是声明，必须有人在计划里点「我已核实」，走已有的 `/promo/verify`。
灰（没人点过）→ 硬门不过 → 批准 409。核实记录已有 `verified_by/verified_at/note`，天然留痕。

---

## 3. 哪些是服务端闸（fail-closed），哪些只是页面提示

| 项 | 服务端拦截点 | 页面提示 |
|---|---|---|
| 经营判断卡结构 | **保存**（zod + 跨字段）→ 400 | 缺哪项高亮 |
| 经营判断卡完整性/新鲜度 | **批准**（硬门）→ 409 | 灯 + 怎么办 |
| 实验卡（仅 `is_experiment`） | **保存**（最大损失区间）+ **批准**（硬门）| 同上 |
| 素材需求/缺口 | 批准（复用已有 `ads.creative_approved` 硬门） | **缺几条、什么角度**（新） |
| 销售承接 | **批准**（硬门 + 人工核实）→ 409 | 没人核实时显示灰 |
| 可承受线索成本 / 保本成交率 | **不拦**（算出来的参考值） | 显示公式与数字；读不到写「未知」 |

**一条通用规矩照旧**：灰 ≠ 绿，灰 ≠ 0；读不到就写读不到。

---

## 4. 风险级与 PR 拆法

| PR | 内容 | 风险级 | 为什么 |
|---|---|---|---|
| 1 | PromoSpec 加三块（`business_case` / `experiment` + `is_experiment` / `sales_handover`）+ zod 与跨字段校验 + 表单字段 + 页面显示；**闸先只显示不拦** | **B** | 只改 `plan_data` JSON，**无 migration**；旧计划没这些字段照常工作（可选字段） |
| 2 | 三个新闸转为硬门（`evaluateApproval` 拦批准）+ 纳入内容指纹与批准快照 | **A** | 动的是**批准闸和钱**；要子牙+魏征两审，PM 回「合 N」 |
| 3 | 素材需求单计算 + 缺口派任务（`task-dispatcher`）+ 页面显示缺口 | **B** | 复用已有任务表与派发逻辑，不新增拦截 |
| 4 | 剧本里补「每阶段要几条素材、提前几天、最大损失比例」等阈值 | **C** | 只加数据，且标 `unvalidated_default` |

**顺序不能换**：PR2 必须在 PR1 之后（没有字段就拦不了），PR3 可与 PR2 并行。
**拆开的理由**：PR1 先让人把卡填起来、看得见；等真有几份计划填过，再把闸锁死（PR2），避免一上来就把所有在途计划卡死。

---

## 5. 回执怎么写（每个 PR 都要）

1. **改了哪些文件 + diff 摘要**；
2. **真跑过的命令与退出码**：`npm run type-check`、`npm test -- <新测试路径>`、`npm run build` 分开记；
3. **当场试跑**：PR1/PR3 不涉及定时任务，但**必须在真实页面上填一份卡并保存成功、再读回库核对**（截图 + 库里 JSON 片段）；
   PR2 必须**当场演示一次拦截**：故意把 `seats_confirmed` 设 false，点批准，贴出 409 与 blockers 原文；
4. **没跑的、被阻塞的分别写明**；
5. **Reuse Statement**：复用了 spec/gates/playbooks/content-hash/task-dispatcher；新增的哪些是平台共享（字段形状、闸、算法）、哪些是行业层（阈值）、哪些是客户数据（卡里的数字）；
   并回答「客户名/客户数字有没有进共享代码」——答案必须是没有。
6. **台账卡**一张，`verify_by` 写第一份真实计划用这套卡批准的日子。

---

## 6. 要 PM 拍一下的（只有两件）

1. **可承受线索成本的算式**（见 §2.1）：每条线索价值 = 每座留存 **×每单座数×** 成交率（我按这个做），还是不乘每单座数？两种差约 1.74 倍。
2. **实验卡是不是每个阶段都要**：我按「阶段上打勾才要」设计（否则纯收割阶段也被迫编一个实验）。

## 7. 没核实的

- `execution_items` 的 `assigned_to` 现在实际怎么用（存邮箱还是名字）、素材类任务有没有既定的 `action_type`，PR3 开工前要先读一遍派发代码再定。
- 「合格咨询」这个指标目前**系统里没有**（`ads.result_defined` 只认 `ad_strategy_configs.primary_result`），实验卡里选它只能当文字记录，算不出数；要真能算，得另立口径（91 号那条「一条询盘」口径可复用）。
- 各团剩余座位目前 CRM 里只有 23 条预订、5 条有广告来源，所以 `seats_remaining` 短期内只能人工填 + 标未确认。

---

## 8. 审查要点（2026-10-18 实做中踩出来的，往后每刀都看）

1. **往 `PromoSpec` 加字段一律不许用 `.default()`。** default 会被写进解析结果 → 每一份旧计划的内容指纹都变一次 → 已批准的计划被判成「内容变过了」、挂在旧指纹上的人工核实记录跟着作废。用 `.optional()`，消费方按 `=== true` / `!== undefined` 读。（这一条是被既有的 `approval-record` 测试当场抓出来的。）
2. **这一层的代码和注释里不许点名团目录的表名**（`tour_catalog_*`）：目录外提到它会被 `src/lib/tour-catalog/__tests__/boundary.test.ts` 拦下，哪怕只是注释。要指班期就写「团目录里的班期编号」。
3. **开 PR 的分支要从主干干净切出**：从带着历史合并的长期分支上切，会出现两个共同祖先，台账检查会把别人的卡算进你的差异里（2026-10-18 实际发生过，PR #2781/#2787 因此作废重开为 #2790/#2791）。
4. 新增字段若要进检查清单，**先做成只显示不拦的软门**，等有几份真填过再转硬门；转硬门那一刀是 A 级。

---

## 9. 2026-10-18 复审后的更正（子牙 + 魏征，必改项逐条对号）

**三处原稿说错了，以这里为准：**

1. **「PR2 动的是钱」不成立 —— 这三个闸只是计划文档闸。** 子牙查实：真正花钱的执行路径不读 `marketing_plans`、不调 `evaluateApproval`；远期阶段的 `deferred_blockers` 唯一消费者是页面渲染，没有任何服务端动作读它。所以把 PR2 定成 A 级的理由不是「碰钱」，而是「改的是批准这道闸本身」——风险级别保持 A，但口径要说对。
2. **素材需求单打算复用的派发路现在是关着的。** `approve/route.ts` 对带 `promo` 字段的计划**显式跳过** `dispatchPlanTasks`；dispatcher 只读 `plan_data.tasks`，insert 里**没有** `assigned_to`；派发还会顺带自动建生产包（会挡住退回草稿）。**PR3 开工前必须先决定：是打开这条路，还是另起一条只派素材任务的路。** 原稿把它当现成的用，是没查到底。
3. **PR2 与 PR3 不能并行**：两者都改 `approve/route.ts`，违反单一写入者。顺序定为 PR1 → PR2 → PR3。

**一处设计必须跟着改：**

4. **剩余座位不进内容指纹。** 原稿把整张经营判断卡放进指纹，但指纹一变，挂在旧指纹上的人工核实记录全部作废、硬门一起变红；而座位数是天天变的事实，且计划一旦批准内容就锁死、反而再也改不了。**已在 `content-hash.ts` 里把 `seats_remaining` / `seats_confirmed` / `seats_as_of` 三项排除**，卡里其余字段照常进指纹（改每座留存、改负责人，指纹仍然会变）。

**页面文案的纪律（魏征必改项，已改）：** 在闸真正读这些卡之前，页面上**不许写「没有这张卡开投前检查过不了」「没确认的座位数不能用来批准开投」**这类话——那是假的。算不出来的数要写清**为什么**算不出（「这根线还没接上」），不许让人以为「过几天就有」。

