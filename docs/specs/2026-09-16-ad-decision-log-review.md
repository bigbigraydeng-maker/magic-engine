# 广告"决策原因"记录该不该做成正式能力 · 设计判断（2026-09-16）

> 状态：**设计判断，未实施，未建表**。供 PM 与负责广告引擎工程的窗口决策是否排期。
> 触发：CTS 广告顾问窗口 2026-09-16 与 PM 交互式敲定一批预算/定向调整后，把"为什么这么改"临时塞进 `ad_entity_snapshots.targeting_summary` 的一个 note 键——这不是这张表设计支持的用法，暴露真实缺口。
> Repository Fact：`origin/main` 2026-09-16，设计基线 `~/.claude/plans/ads-impact-loop-capability.md`（2026-09-14 两轮复审收敛，`origin/main = 82dae3c8...`）。

---

## 0. 一句话结论

**不建议现在给 `ad_entity_snapshots` 加字段，也不建议新建一张独立表。建议扩展仓库里已经存在的 `client_decision_history`（诸葛亮决策历史表），给它补几个广告场景需要的列（`affected_entities` / 快照关联 / `source` / `flywheel_action_id`），只做人工决策留痕，不冒充内核授权。等阶段 2 内核给广告动作接上人审批后：(1) 记录职责天然转移给内核 `action_runs.rationale` / `authorization_decisions.reason`；(2) 交互式顾问对话**必须硬性停止直接改 Meta 配置**，改为提交同一套内核动作——不是"旁路慢慢变少"，是切换那一刻起旁路写入被禁止。优先级 P2（按 §11 三维打分：频率中 + IMPACT 中 + 收入低 = 中中低），排在已定的阶段 0/1（P0）之后，不需要插队。**排期实施前还有三个未解决的口子（§2.1 写入所有权、§2.2 Outcome 读取链路、§2.3 跨账户归因作用域），本稿只把它们判清楚、列成实施前置门槛，不在本稿内解决。**

---

## 1. 现有设计里已经想过、也已经预留了这件事——但预留在阶段 2，不在阶段 1

读 `~/.claude/plans/ads-impact-loop-capability.md` 全文，"为什么"这件事不是被漏掉，而是被有意放进了阶段 2（内核 + 执行）：

- §1.4 冻结约束第一条：「Act：人审批 → **内核授权** → Connector 执行 → 回执」。
- §4.4 Inngest 事件链：`ads.prescription.approved`（人）→ `ads.kernel.authorized`，每步 receipt 要求含 `status、cost/provider 影响、no_publish/authorization 状态、created_at`。
- 内核本身（`src/lib/kernel/types.ts:252-278`、`:303-346`）**已经有**专门装"为什么"的字段：`AuthorizationDecision.reason`（授权判定的理由）、`ActionRun.rationale`（这次执行的理由）、`ActionRun.evidence`（支撑证据）。这套机制不是要新造，是**已经在生产跑**（`page.*` 动作已用过），只是广告动作还没接进去。
  **但这三个字段现在都不是强制留痕**：`ActionRun.rationale` 类型是 `string | null`（`src/lib/kernel/types.ts:307`），`src/lib/kernel-approval/service.ts` 的 `readReason` 只在 `resolution === 'reject'` 时要求非空，`approve` 分支的 `reason` 是可选的、留空也能批准（同文件 `decideApproval` 把 `input.reason` 原样透传，不校验非空）。也就是说，广告动作接进内核之后，如果沿用现在这套通用审批契约，审批人不填备注时 `authorization_decisions.reason` 只会落一句"某人点了同意、规则未变"式的通用审计文字，说明不了"为什么调预算/为什么关这个受众"——阶段 2 要接手这份职责，必须先把广告动作提交/批准契约里的业务理由字段改成必填，而不是直接沿用现有的可选 `reason`。
- §14.1 K1–K14 是"内核先行"的具体条款：K2 明确「广告动作一律人审批，不论客户策略」，K5 要求「每次运行挂真实 Goal」——这套流程本来就会在授权那一刻强制留痕"为什么"，不需要另开一个字段。
- §1.4 还有一条更关键的冻结约束：**"不许'先预留兼容 key、以后再迁内核'"（build-order 明确否掉）**。这条直接排除了"现在先在 `ad_entity_snapshots` 加个 `decision_reason` 字段、以后再接进内核"这条路——那正是被设计复审明确否掉的做法。

**结论**：不是没考虑过，是考虑过之后，故意把"为什么"这件事的正式家安在阶段 2 的内核里，不安在阶段 1 的快照表里。今天发生的事，本质是**阶段 2 还没上线，但一次交互式顾问对话已经绕开阶段 1/2 的全部规划，直接对 Meta 做了真实修改**——这是流程缺口，不是字段缺口。

---

## 2. `ad_entity_snapshots` 为什么不该加这个字段（读了实际表结构）

表定义：`supabase/migrations/20260914000001_ad_entity_snapshots_and_video_metrics.sql`。

- **这张表的语义是"机器每次抓到 Meta 现在的设置是什么样"**，`capture_reason` 枚举严格限定为 `first_seen / changed / daily / disappeared / kernel_pre / kernel_post`——六个值全部描述**为什么机器又抓了一行**，没有一个值是"人为什么改了这个"。塞一个 `decision_reason` 进去，等于在一张"设置快照表"里混入一个跟快照语义无关的人工字段，且没有配套的 `capture_reason` 值能标注它。
- **`targeting_summary` jsonb 字段的文档注释原话是"只做人看和变化比对，不做判定"**（migration 第 62 行）。9/16 的权宜做法（把 note 塞进这个字段）已经违反了这张表自己写明的用途——这不是"权宜可行只是不优雅"，是**已经用错了字段**，往后任何读这张表做"变化比对"的诊断代码都可能把这条人工 note 当成定向摘要的一部分误读。
- **一次决策往往牵连多个实体、跨两个账户**（今天这批就是：中文广告下架 + 两账户预算调到合计 $150/天，涉及多条广告系列/广告组）。快照表是"实体级、逐行"的存储形状；一条决策理由要么被复制粘贴进每一个受影响实体的行里（冗余、容易不同步），要么像今天这样只挑一个实体挂上（信息丢失，看不出这条理由其实覆盖了另外三条广告系列）。**决策和快照不是一对一关系，不该共用一张表、一行数据。**

---

## 2.1 建新表之前先查过：仓库已经有 `client_decision_history`，能不能直接扩它

初稿写完选项 B 之后复查发现遗漏——仓库里**已经有一张语义几乎重合的表**，不是从零开始的空白地带：

- `supabase/migrations/20260610000001_phase23_memory_tables.sql:114-147` 的 `client_decision_history`：`client_id`、`decision_context`（决策背景简述）、`chosen_action`（最终选择）、`alternatives_rejected`（被排除的候选）、`reasoning`（为什么，NOT NULL）、`outcome_verdict` / `outcome_notes`（结果回填）、`zhuge_session_id`（可选溯源）。
- `src/lib/memory/service.ts:289-310` 的 `loadRecentDecisions` **只**从 `client_decision_history` 按 `client_id` 查最近 N 条，供 `memory/format.ts` 拼进「Recent Decisions」段，喂给鲁班（`luban/project-prompts.ts`）和华佗（长模式）的 prompt——这是当前系统里**唯一**一条"decision → 注入 agent 记忆"的读取路径。
- 如果广告决策理由写进选项 B 草案里另开的 `ad_decision_log`，这条读取路径**看不到它**：鲁班/华佗生成下一轮建议时，完全不知道"CTS 上周刚决定过不投华人市场"，同一客户的决策事实被拆成两张互不相通的表，`client_decision_history` 里关于该客户的决策历史反而是不完整的——这正是 §0 平台化铁律要求先查的"已有封装"，之前的草案没查到，是本稿的疏漏。

**结论：不新建 `ad_decision_log`，改为扩展 `client_decision_history`。** 理由：
1. 字段语义对得上——`decision_summary`≈`chosen_action`（"中文广告下架、预算收紧"本身就是"选择的行动"）、`reasoning`≈`reasoning`（已经 NOT NULL）、`decided_by`/`affected_entities`/快照关联/`source` 是广告场景需要新增的列，`ALTER TABLE ADD COLUMN`（均可空或带默认值）即可，不破坏现有诸葛亮写入路径。
2. **写入权限——上一稿判断"不冲突"是错的，这里改正**：`docs/agents/CODEX.md:84-87`「写权限矩阵（严格）」白纸黑字写着「`client_decision_history`：只有诸葛亮（conductor）写」，`docs/agents/00-architecture.md:101-106` 也把这张表定义为「诸葛亮决策记录，诸葛亮写，23.C 回填」。选项 B 现在的写法——交互式顾问会话直接写一行 `source = interactive_advisor_session` 的记录——会让这张被鲁班/华佗 prompt 无条件信任的客户记忆多出一个绕过诸葛亮的写入方，这不是"加个 source 列区分来源"就能带过的小事，是直接违反了已经写进架构文档的写入所有权约定。**排期实施前必须先二选一，并各自过一次架构复审，不能原样按现在的草案实施**：
   - **方案甲（改写入所有权文档）**：把"交互式顾问人工决策"正式纳入 `client_decision_history` 的合法写入方，同步修订 `CODEX.md` 写权限矩阵与 `00-architecture.md` §5.1 表格，明确写清楚"诸葛亮 AI 决策 + 交互式顾问人工决策"两类写入方各自的边界与谁负责校验（例如是否需要 `decided_by` 非空、是否需要会话侧鉴权）；
   - **方案乙（不改所有权，路由通过诸葛亮）**：交互式顾问会话不直接写表，而是把这条人工决策"提交"给诸葛亮（复用 `src/lib/zhuge/action-persister.ts` 现有的落库入口），由诸葛亮作为唯一写入方代为落库，`source = interactive_advisor_session` 只是诸葛亮写入时打的标记，写入所有权原样保持"只有诸葛亮写"不被打破。
   本文档不预设选哪个，但明确**两个都没做之前，不能按现在的草案直接开一条新写入方**。
3. 读取路径零改动——`loadRecentDecisions` 是 `select('*')`，新增列自动被查出来；只要 `format.ts` 拼装文案时对 `source = interactive_advisor_session` 的行做人类可读的展示（而不是当成 AI 决策展示），鲁班/华佗立刻就能看到广告顾问的决策历史，不需要新写一条读取/迁移路径。

---

## 2.2 结果关联：不能只挂设置快照，要挂到可归因的 Outcome

`before_snapshot_ids` / `after_snapshot_ids` 只能证明"决策前后 Meta 设置分别是什么"，回答不了"这个决策对不对"——设置变了不代表效果变了。§0 提到本表未来两个用途（验证决策对不对、训练决策 agent）都需要能追溯到**表现指标**，不是设置差异。

仓库里已经有这条链路，不需要新造：`flywheel_actions`（`supabase/migrations/20260517000001_flywheel_data_skeleton.sql:18-43`，含 `flywheel`/`action_type`/`expected_metric`/`expected_delta`）→ 由 P12.A.8 attribution job 写入 `flywheel_outcomes`（同文件 :76-101，含 `baseline`/`after_value`/`delta`/`confidence`/`verdict`/`window_days`）。这套"动作 → 归因结果"的表结构和计算任务已经在生产跑，只是广告顾问的交互式决策目前从不写 `flywheel_actions` 行，所以挂不上去。

**因此草案新增 `flywheel_action_id`（见 §3 选项 B）**：交互式顾问对话做出一次广告决策时，如果这次改动预期影响某个可衡量指标（如 `ADS_METRIC_KEY.ROAS` / `ADS_METRIC_KEY.COST_PER_LEAD`，实际取值 `ads.account.roas` / `ads.account.cost_per_lead`，见 §3 选项 B 更正后的示例），**必须同时补写一行 `flywheel_actions`**（`flywheel = 'ads'`、`action_type` 用已在 `ADS_ACTION_TYPE` 登记的动作类型、`expected_metric`/`expected_delta` 按决策时的预期填），再把新生成的 `flywheel_actions.id` 回填进 `client_decision_history.flywheel_action_id`。这一步能让 P12.A.8 现有的 attribution job 产出对应的 `flywheel_outcomes` 行——但**这只解决了"归因结果写到哪张表"，不等于"决策记录能看到这个结果"**。

**上一稿"决策记录就有了可验证的 Outcome"这句话不成立，这里改正**：`loadRecentDecisions`（`src/lib/memory/service.ts:289-310`）只查 `client_decision_history` 自己这张表，`formatMemoryForPrompt`（`src/lib/memory/format.ts:117`）拼进 prompt 的也是这张表自身的 `outcome_verdict` 列——两者都不知道 `flywheel_outcomes` 这张表的存在，不会因为多了一个 `flywheel_action_id` 外键就自动跨表 join。而负责把归因结果回填进 `outcome_verdict` 的自动抽取逻辑，已经在 `src/lib/memory/extractor.ts:254-272` 因"判据错误、把无关决策一起盖章"而**永久停用**（2026-09-06），且注释明确写着"要重做的话，判据必须换成只匹配这条决策所关联动作的 outcome……但 `client_decision_history` 目前没有指向 action 的外键，接不上就别猜"。也就是说：加了 `flywheel_action_id` 这个外键之后，"接上"的前提条件才第一次具备，但**回填这一步本身仍然没有做**，鲁班/华佗看到的 `outcome_verdict` 依旧会是 `null`，跟没加这个外键之前一样看不到结果。

**因此本草案的 Outcome 关联目前只到"数据接得上"，没到"agent 看得见"**：排期实施时必须在选项 B 之外再交付一条读取链路，二选一（本文档不预设，需要工程窗口按当时的 attribution job 现状定）：
- 重新打开 §2.2 提到的回填逻辑，但按注释要求的正确判据重写——按 `flywheel_action_id` 精确匹配这条决策自己的 `flywheel_outcomes` 行去更新 `outcome_verdict`，而不是按客户时间窗多数票；或
- 不回填 `outcome_verdict`，改为在 `loadRecentDecisions`/`formatMemoryForPrompt` 读取时对有 `flywheel_action_id` 的行额外查一次 `flywheel_outcomes`（按 `action_id` 精确匹配）拼进文案，让"决策"与"结果"在读取层 join，而不是在写入层回填。

**如果这次改动没有明确的预期指标（例如纯合规性下架），允许 `flywheel_action_id` 留空**，不强求每条决策都编一个假的预期指标。

---

## 2.3 结果关联的第二个缺口：`flywheel_action_id` 没带账户/实体作用域，跨账户决策会被误归因

触发本设计的 2026-09-16 决策本身就横跨两个广告账户（中文广告下架 + 两账户预算调整），但 §2.2/§3 草案里 `flywheel_actions` 一行只挂 `client_id` + `expected_metric`，没有账户或实体维度；`latestMetricValue`（`src/lib/flywheel/attribution/job.ts:290-310`）取 baseline/after 时也只按 `client_id` + `metric_key` 过滤 `flywheel_metrics`，完全不看 `source_ref` 里可能存在的账户信息（`flywheel_metrics` 表本身也没有 `ad_account_id` 列，只有一个未被索引/未被 job 读取的 `source_ref` jsonb）。

后果：如果同一客户在决策前后**另一个**广告账户（或 Meta/Google 两个平台）恰好也有指标波动，attribution job 会把它当成"这条决策之后的表现"一起算进 `before`/`after`，得出一个把无关账户变化算在这次决策头上的归因结果——这正是本文档 §0 强调的"验证决策对不对"这个目标要极力避免的假阳性/假阴性来源。

**这不是 `client_decision_history` 扩表能单独解决的问题，是 `flywheel_metrics`/attribution job 当前架构本身缺账户级作用域**（不只影响广告决策日志这一个用例，凡是一个客户有多个广告账户时，现有 attribution 都可能有这个问题，只是今天这次交互式决策第一次把它暴露出来）。因此：

- **单账户决策**：`flywheel_action_id` 可以按 §2.2 方式正常挂接，归因结果可信。
- **跨账户/跨平台决策**（今天这次属于这类）：在 attribution job 获得账户级作用域之前，**不建议**为这类决策写单个笼统的 `flywheel_actions` 行去声称"可验证"——要么按受影响账户拆成多行 `flywheel_actions`（每行只对应一个账户的预期指标变化，前提是 `flywheel_metrics`/`source_ref` 那一侧也要能按账户查到对应的行，目前不能），要么先把 `flywheel_action_id` 留空，只做人工留痕，明确标注"这条决策的归因验证依赖账户级作用域，当前架构暂不支持"，而不是对 PM 宣称已经拿到了可验证 Outcome。
- 排期实施前需要工程窗口先确认：是否要顺带给 `flywheel_metrics`/attribution job 加账户级作用域（更大的改动，超出本设计判断范围），还是本轮先只处理单账户场景、跨账户场景继续留空并注明限制。

---

## 3. 该往哪走：三个选项逐一判断

### 选项 A——现在就给 `ad_entity_snapshots` 加 `decision_reason` 字段
**不建议。** 理由见上 §1 末尾（撞上"禁止预留兼容 key 以后迁内核"的冻结约束）与 §2（字段语义、多对一关系都不匹配）。

### 选项 B——扩展 `client_decision_history`，不建新表
**建议，但要明确这是过渡态，不是终态。**（本稿复查后已从"另建 `ad_decision_log`"改为"扩展现有表"，见 §2.1。）

设计草案（仅供工程窗口参考，非最终 schema；均为对 `client_decision_history` 的 `ALTER TABLE ADD COLUMN IF NOT EXISTS`，不改动现有列语义）：

```
client_decision_history  -- 已存在，新增以下列
  decided_by          text                   -- 新增，可空。PM/FDE 姓名或标识；AI 决策（现状）留空
  affected_entities   jsonb                  -- 新增，可空。[{ad_account_id, level, entity_id, entity_name}]（注：目前只是人读的记录，attribution job 不读取，不构成 §2.3 要求的账户级作用域）
  before_snapshot_ids uuid[]                 -- 新增，可空。关联 ad_entity_snapshots.id（决策前状态）
  after_snapshot_ids  uuid[]                 -- 新增，可空。关联决策后下一次抓到的快照
  flywheel_action_id  uuid REFERENCES flywheel_actions(id) ON DELETE SET NULL  -- 新增，可空，见 §2.2
  source              text NOT NULL DEFAULT 'ai_generated'
                        CHECK (source IN ('ai_generated', 'interactive_advisor_session', 'kernel_migrated'))
  session_ref         text                   -- 新增，可空。顾问窗口/会话标识（非诸葛亮 session 时用，`zhuge_session_id` 继续给诸葛亮用）
```

**为什么这样设计能避开"预留兼容 key"的红线**：新增列**不**声明 `verdict`、`policy_id`、`idempotency_key` 这类内核授权语义的字段，不冒充是内核的一部分，也不参与任何执行/授权判断——它只是给已有的人工/AI 决策日志本补几列，跟内核平行存在，不是内核的影子。`source` 字段从一开始就写明"这是交互式旁路留下的记录"，不是"内核动作的记录"，避免未来把它误认成内核数据的一部分。

**上线路径（阶段 2 后旁路必须硬性关闭，不是自然萎缩）**：等阶段 2 `ads.*` 动作注册进内核、K2（一律人审批）落地后：
1. 广告变更理由自然由 `authorization_decisions.reason` / `action_runs.rationale` 承载，`client_decision_history` 的 `source = interactive_advisor_session` 分支停止新增；
2. **交互式顾问对话必须被明确禁止继续直接改 Meta 配置**——阶段 2 上线的同时，顾问窗口的输出改为提交同一套内核 `ads.*` 动作（人审批 → 内核授权 → Connector 执行 → 回执），不再允许对话本身直接调用 Meta API 写配置。这不是"可选的收紧建议"：阶段 2 上线后如果仍放行这条旁路，就等于生产环境里始终留着一条不经过授权、成本检查、执行回执的真实预算/定向写入路径，事后补一行决策日志无法补回这些安全保证。阶段 2 的实施 PR 必须包含"移除/下线交互式顾问直写 Meta 的代码路径"这一项，不能只上线内核、放着旧路径继续能跑。

**不建议现在做数据搬迁或字段映射设计**，避免过度设计一个明知会在阶段 2 上线当天清零的过渡态。

**前置条件（停写过渡列的硬门槛，不是可选优化）**：这条"理由自然由内核字段承载"的判断，只有在广告动作的提交/批准契约把业务理由设为**必填**之后才成立。现有的通用审批服务（`src/lib/kernel-approval/service.ts` 的 `readReason`）只在拒绝时强制填理由，批准时 `reason` 可选、留空也能过——`ActionRun.rationale` 本身的类型也是 `string | null`。如果广告动作原样套用这套通用契约，阶段 2 上线后审批人不填备注，`authorization_decisions.reason` 只会是"某人点了同意"这类通用审计文字，说明不了业务理由，本文要解决的数据缺口会原样重现。因此：**停止往 `client_decision_history` 写 `source = interactive_advisor_session` 的新记录，必须以"广告动作的提交或批准入口已把业务理由改成必填"且"交互式旁路代码路径已下线"两个条件同时满足为前提**，不能只等内核接入广告动作这一件事就直接停写。

**开始实施前的三个硬门槛（Codex round 3 复审新增，缺一不可，均不能靠"先写代码再补"绕过）**：
1. **写入所有权先落地**：按 §2.1 的方案甲或方案乙先解决"交互式顾问会话直接写 `client_decision_history` 违反既有写权限矩阵（`docs/agents/CODEX.md`/`00-architecture.md` 明确只许诸葛亮写）"这件事，并让改动过一次架构复审，再开放这条写入路径。
2. **Outcome 读取链路一并交付**：按 §2.2 的两个选项之一（重写回填判据，或读取时按 `flywheel_action_id` join `flywheel_outcomes`），不能只加 `flywheel_action_id` 外键就宣称"决策记录有了可验证 Outcome"——那句话现在不成立，鲁班/华佗看到的 `outcome_verdict` 依旧是 `null`。
3. **账户作用域先分单账户/跨账户处理**：按 §2.3，单账户决策可以正常挂 `flywheel_action_id`；跨账户/跨平台决策在 attribution job 拿到账户级作用域之前，`flywheel_action_id` 只能留空并注明限制，不能对外宣称已验证。
4. **动作类型与指标键必须用已登记值**：`flywheel_actions.action_type` 必须是 `src/lib/flywheel/vocabulary.ts` 的 `ADS_ACTION_TYPE` 里已登记的值（现有枚举没有"交互式预算调整"这个动作，需要先补登记一个，例如比照现有命名风格加 `ADJUST_BUDGET: 'ads.adjust_budget'`，而不是在草案里现造一个不存在的字符串）；`expected_metric` 必须走 `resolveAdsExpectedMetric` / `ADS_METRIC_KEY`（如 `ads.account.roas`、`ads.account.cost_per_lead`），否则 `MetaAdsAdapter.execute` 的 `assertAdsExpectedMetric` 与 `persistZhugeActions` 的同名校验会直接拒绝写入；绕开校验直接插表则 attribution job 按指标键精确匹配，永远找不到对应的测量记录。

### 选项 C——什么都不做，等阶段 2 内核上线再说
**不建议现在就是唯一路径**，但值得指出：阶段 2（内核 + 执行）在设计文档 §9 里已经被判定为 **P2**，排在阶段 0/1（P0，还在等 PM go apply migration）之后，短期内不会上线。如果什么都不做，接下来每一次顾问窗口的交互式决策都会重复今天这次"临时找个字段塞"的权宜操作，PM 要的"验证决策对不对"和"训练决策 agent"这两个目标会持续拿不到干净数据——**这是选 C 的真实代价**，需要 PM 知情。

---

## 4. 更根本的问题：交互式顾问对话本身有没有绕过内核，这件事本身要不要被收编

任务里问到的第三个岔路——"现在这种'交互式顾问对话直接改配置'的操作模式本身要不要收编进内核"——这是一个比"加不加字段"更大的问题，本次不展开设计，但明确指出：

- 今天的操作（PM 在顾问窗口跟 agent 对话，agent 直接对 Meta 做真实修改）**完全不在设计文档 §4 的执行链路里**——它既没有走 `budget_move_plan` 这类内核动作（还没建），也没有走现有的 `stop-loss.ts` / `draft-and-gate` 审批链（那是为止损和加广告组设计的，不是为"跟 PM 聊完直接调预算"设计的）。
- 换句话说，这不是"决策原因没地方存"这一个孤立缺口，而是**"交互式广告顾问"这整个工作模式，从一开始就没有被设计文档承认为一种正式的 Act 执行路径**。它是当前唯一能干活的方式（阶段 2 没上线），但从治理角度看，它绕开了 CLAUDE.md 铁律 3 对 Inngest 的硬约束（"凡是代码设计涉及跨步骤异步接力或外部副作用，必须把 Inngest 作为默认工作流层接入"）——今天这次预算调整是对 Meta 的真实外部副作用，却没有走 Inngest、没有机器可读回执，只有事后手工写的这几行快照。
- **这个问题不建议现在单独立项解决**（会话结束前不做无边界的新设计），但建议 PM 知情：**在阶段 2 内核上线之前，"交互式顾问对话改真实广告配置"这个模式本身就是一个已知的治理空白，选项 B 的表扩展只是给它补一个日志，不是给它补治理**。真正的治理只有阶段 2 上线才会到位——且见 §3 选项 B 的"上线路径"：阶段 2 上线必须**同一 PR 内**下线交互式顾问直写 Meta 的代码路径，不能让这条旁路在内核上线后继续存在。

---

## 5. 平台层级门判定（Full Report · 按 `me-platform-tier-gate` skill）

**被判定对象**：广告决策原因/决策日志能力（选项 B：扩展既有 `client_decision_history` 表 + 记录约定，见 §2.1/§3）

**建议层级**：**L1 Capability（既有能力线内部扩展，非新支柱、非新能力线）**

**归属**：
- [x] 平台基础设施：Kernel / Governance（Attribution/Verification 相邻）——本质是内核 `AuthorizationDecision.reason` / `ActionRun.rationale` 这套"决策留痕"机制，在内核还没接管广告动作前的一个过渡态延伸，不是广告支柱独有的能力；同时复用 `client_decision_history`（既有 memory 平台能力）与 `flywheel_actions`/`flywheel_outcomes`（既有 Attribution 平台能力），不新增独立数据面

**换客户测试**：✓
- CTS（旅游）：今天的真实触发场景——中文广告下架 + 预算收紧，决策理由是客户市场定位判断，新增列设计（`affected_entities` / 快照关联 / `flywheel_action_id`）不含任何 CTS 专属结构。
- NAL（物流）/ Oztop（建材）：同样会有"为什么调预算""为什么关某个受众"的交互式决策，表结构原样适用，无需改字段。

**换行业测试**：✓
- 换到地产（Roman）、电商，"顾问跟 PM 对话 → 拍板 → 需要留痕为什么"这个模式与行业无关；`reasoning` 是自由文本，不预设任何行业词汇或判断规则。

**智能层 or 执行手**：都不是——这是一个**纯记录机制**，不做判断、不做执行，本质上是给已有的 Kernel Governance 机制打一个过渡期的补丁,不产生新的智能层。

**红线检查**：
- 红线 1（禁包装升级）：✓ 没有包装成"决策智能层"，明确是内核治理机制的临时延伸
- 红线 2（禁客户/行业事实进 shared runtime）：✓ 表结构不含任何客户名/行业硬编码，`client_id` 参数化，`reasoning` 是自由文本不是判断规则
- 红线 3（禁直建 L1）：**不适用**——这不是单客户提出的新 Capability 语义，是已经被判定为 L1（广告支柱 `operating_legacy`，§8 张良判定）的既有能力线内部的字段/表设计延伸，参照既有先例（M1-M9 §14.2 已经是同一张设计文档下的数据模型条款）
- 红线 4（换客户测试语义级）：✓ 见上
- 红线 5（换行业测试语义级）：✓ 见上
- 红线 6（若 L1，走五道 Build Gate）：适用——若排期实施，需完整走 Repository Fact → Domain Semantics → Product → Architecture/Reuse → GO BUILD
- 红线 7（L2 只装行业级/版本级）：不适用（本判定不是 L2）

**PM 待拍板项**：无新增商业决策；沿用 §13 已有拍板范围（预算挪动策略、CTS 预算锁）

**结论**：
- 原本想法层级：不确定（PM 任务原文本身列了"加字段 / 独立表 / 等内核"三个候选，未预设层级）
- Skill 判定层级：**L1，既有广告支柱/Kernel 治理机制内部扩展**
- **不需要新登记 `docs/registry/platform-candidates.md`**——理由：这不是"单客户提出的新能力，证据不足需要候选观察"的场景（红线 3 的适用范围），而是设计文档 §8 已经判定过的既有 L1 能力线（广告支柱 IMPACT 闭环升级）内部的一处数据模型缺口，性质上等同于 §14.2 M1-M9 这些"数据与诊断"条款，应该按同样方式处理——**作为该设计文档/ROADMAP 的一条新增待办**，不占用候选登记名额
- 下一步：已作为待办写入 [`docs/ROADMAP.md`](../ROADMAP.md) 广告支柱段落 + 本文档存档；由负责广告引擎工程的窗口按 §6 优先级排期，实施前需走大任务 2 审（子牙 + 魏征，因为触碰 schema）

---

## 6. 资源优先级判断（按 §11 三维打分，不跳步）

- **频率**：中——不是每天都发生，但顾问窗口跟 PM 交互式敲定广告调整是**已确认会反复发生**的工作模式（这已经是近几周第 2、3 次同类窗口），不是异常边界场景。
- **IMPACT 闭环关键度**：中——卡在 Measure/Tune 段，且是**诚实的数据缺口**（不是给错误信号、不是说谎的指标），只是"决策为什么"这份素材没留痕，不阻塞任何执行、不会导致当场做反方向决策。
- **收入关联度**：低——不直接触发客户投诉、续费或流失；价值在于未来复盘广告决策质量、以及 PM 明确提到的"训练广告决策 agent"，属内部治理与长期资产积累，不是客户能直接感知的东西。

→ **中中低 → P2，排队，资源富余时做**。不需要插队到阶段 0/1（两者都是 P0，且阶段 1 还在等 PM go apply migration）之前。

---

## 7. Reuse Statement

- **复用了什么已有平台能力？** 三处，均为已在生产跑的既有能力，不新建数据面：(1) `client_decision_history`（`src/lib/memory/service.ts` 的 `loadRecentDecisions` 读取路径）——直接扩列，而不是像初稿那样另开 `ad_decision_log`，理由见 §2.1；**但该表现有写权限矩阵只许诸葛亮写，复用前必须先按 §2.1 方案甲/乙解决写入所有权，不是直接多开一个写入方**；(2) `flywheel_actions` / `flywheel_outcomes`（P12.A.8 attribution job）——用 `flywheel_action_id` 挂接归因结果所在的表，而不是自己发明一套验证窗口字段；**但目前只做到"接得上"，"决策记录读得到 Outcome"和"跨账户决策不被误归因"这两条分别还缺 §2.2 的读取链路和 §2.3 的账户作用域，均需工程窗口补上才能兑现**；(3) 内核的"决策留痕"设计理念（`AuthorizationDecision.reason` / `ActionRun.rationale`）——新增列命名与语义有意向内核靠拢，方便未来对照，但不复用内核的表本身（内核尚未接管广告动作，参照 §1.4 冻结约束不允许预先接线）。
- **新增内容哪些是真正 platform-shared？** 若选项 B 落地，`client_decision_history` 新增的列（`affected_entities`/快照关联/`source`/`flywheel_action_id`/`session_ref`）对所有广告客户通用，属广告支柱 L1 内部的共享数据模型扩展；`source` 枚举扩展本身也是通用的（区分 AI 决策 vs 交互式人工决策）。
- **哪些是 industry-specific？** 无——`reasoning` 是自由文本，不预置任何行业词汇或权重。
- **哪些是 client-specific？** 每一行的具体决策内容（"CTS 不投华人市场"这类事实）天然是 client-specific 数据，正常存在 `client_id` 限定的行里，不进 shared runtime 的判断逻辑。
- **有没有把客户名、客户 ID、行业判断或客户私有事实写进 shared runtime？** 没有；`client_id` 是数据行的外键，不是代码里的硬编码判断。
- **哪些学习仍只在 client-private memory，哪些有证据升级到 industry/global memory？** 本设计判断本身不产生新的 memory 升级；但因为改成扩展 `client_decision_history` 而不是另开孤立表，广告顾问的交互式决策**从写入的那一刻起就进入既有的鲁班/华佗 memory 注入路径**（`loadRecentDecisions` → `memory/format.ts`），不需要额外一次迁移就能被下一轮 agent 生成看到——这是相对初稿"另建表"方案多出的一项复用收益。是否进一步升级到 industry/global memory 仍是另一个需要单独评估的话题（本次不展开）。

---

## 8. 给 PM 的三句话总结

**第一件事：加字段不对，但也不用另开新表——仓库里已经有一张能扩的表，只是这张表现在规定"只有 AI 能写"，得先解决这一步。**
今天临时塞进快照表 note 里的做法用错了地方——那张表是给机器自动记"Meta 现在设置是什么样"用的，不是给人记"为什么改"用的。复查后发现更省事的做法：仓库里已经有一张"诸葛亮决策历史表"记录 AI 每次决策的理由，结构跟广告决策要存的东西很像，给它加几列（谁改的、影响哪些广告、决策前后对比）就够用，不用另起炉灶，也不会让同一个客户的决策记录分裂成两处。**但这张表现在的规矩是"只有 AI（诸葛亮）能往里写"，要让人在顾问窗口里的决策也写进去，得先决定是把这条规矩正式改掉、还是让人的决策也经 AI 之手落库，这一步需要过一次架构复审，不是加几列就能直接开写。**"决策记录能不能自动看到效果好不好"这条也还没打通，需要另外补一条读取链路（见本文档 §2.2）。不是当务之急（下面第三件事说明为什么），先记进待办即可。

**第二件事：这件事本来就在原计划里，只是排在后面（阶段 2），不是被漏掉了。**
原设计里"人为什么批准这次改动"这件事，本来就打算靠"内核"（一套管审批和执行的底层机制）自动记录，只是内核目前只接管了极少数动作，广告类的改动还没接进去。今天发生的，是内核还没接的那部分先被人工绕过去改了——这是流程还没补齐的正常过渡期现象，不是设计漏项。
**但有两个前置条件**：(1) 现在内核里"批准时填理由"这一步是可以留空的（只有"拒绝"才强制要求写理由）。阶段 2 把广告动作接进内核时，必须顺手把"批准也要填理由"这条改成强制，不然内核接进来了、批准人还是不填备注，"为什么调预算"这件事一样记不下来。(2) **阶段 2 上线的同一次改动里，必须把"跟我这样聊完直接改 Meta"这条路彻底堵死**——不是慢慢淘汰，是切换那天起，广告顾问的建议一律先走内核审批，不能再由对话直接下手改真实广告账户。这两个条件不满足之前，还是得靠这张过渡记录兜底，不能想当然认为内核一接入问题就自动解决。

**第三件事：按频率/关键度/收入三项打分，这件事排 P2（不着急），先干阶段 0/1 那些已经定好、在等你批准上线的事。**
这件事频率中等、不影响当前广告在跑的判断、也不直接关系客户投诉/续费，所以不需要插队。已经写进 [ROADMAP](../ROADMAP.md) 待办，交给负责广告引擎的窗口在阶段 0/1 忙完之后接手；需要我现在就去扩那张决策历史表的话，回 `开始` 我就去做（大约要过一次架构复审再实施，不是当场改库）。
