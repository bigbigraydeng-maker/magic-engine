# CRM：把 AI 读对话得出的「事实」存下来，每天 20 个名单据此排序（v0.2 设计稿，两审已过，砍小版；待 PM 先标 10 个 + 回「合」）

**状态**：v0.2 · 2026-10-10 · 子牙 + 魏征两审意见已并入（§三）· **闸门一：PM 先标 10 个「欠报价」样本，看有没有「不该」** → 闸门二：PM 回「合」→ 才开 PR（A 级，草稿，拆两个）
**风险级别**：**A**（新增一张表 = 改数据库结构；新增一个会自己重复调用付费 AI 的自动任务）
**提出人**：PM 2026-10-10。「每天 20 个」「全都是该」「做 + 小版本都做」。
**§11 资源优先级**：频率 **高**（销售每天靠它决定先打谁）/ IMPACT **高**（Act：名单排错 = 欠着报价的客人没人跟）/ 收入 **高**（NAL 月目标 300 开聊；审计查出 52 个客人说清了货、我们欠一份报价）→ 高高高 → **P0**
**不做**：不改分段引擎的判据；不动 `conversation_briefs` 那张表和它的提示词；不把意向档（高 / 中 / 低）重新接回名单；不对外发任何东西；不给别的客户开（先只 NAL）。

---

## 一、给 PM 看的一页纸

### 现在为什么不行

「今天要联系」只认系统本来就知道的事（谁最后说话、等了几天）。可你盲测的 10 个客人里，7 个躺在「先放着」，原因是系统不知道**这个人把货说清了、我们还欠一份报价**——这件事只有读完对话才看得出来。上一轮我用 AI 现读了 198 个人，得出：欠报价 52 人、客人最后一句话没人回 27 人。

### 做什么

给每段对话存一行「事实」，不存「意向高 / 低」这种感觉，只存**七个是 / 否**：
垃圾无关？客人给了具体货物？我们真人报过价？约了下一步？已下单？我们明说做不了？客人最后说不要？
外加两个纯数据量：**最后一句是谁说的、多久没动静**。

名单排序改成（只在「今天要联系」里，每天 20 个）：

1. 约好今天回电的（我们答应过的事）
2. 客人给了具体货物、**我们还欠报价**的
3. 客人最后一句话**没人回**的
4. 其余现有「今天要联系」里的人，最近有动静的排前

「先放着」里满足 2 或 3 的人**升进「今天要联系」**，排在第 20 个之后的照样列出来、只是画线写明排队（这条线已在 PR #2421 里做了）。**没人因此消失。**

### 页面上会多几个字、少几个字

| 位置 | 少了 | 多了 |
|---|---|---|
| 「今天要联系」每一行的理由 | 无 | 欠报价的写「客人把货说清了，我们还没报价」；等我们回的写「客人最后一句话没人回，已经 N 天」 |
| 「先放着」 | 约 79 位被升上去的人（NAL 实测） | 无 |
| 侧栏 | 无 | 无 |

### 要花多少钱

- NAL 首次把 198 + 28 个人全读一遍：约 **0.7 美元**（上一轮实测 19 万输入 / 2 万输出 token）。
- 之后只在「这段对话有了新消息」时重读那一段，NAL 每天新消息量级几十条：**每天几美分**。
- 每天最多读 80 段（硬上限）；当月累计超过 15 美元自动停并报警（上限数字 PM 可改）。

### 请 PM 回

- 回 `合`：我才开 PR（A 级，草稿）、建表、接任务；
- 回 `改` + 一句：先改稿。

---

## 二、给工程看的部分

### 2.1 一张新表 `conversation_facts`

```sql
create table conversation_facts (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  schema_version int not null default 1,
  model text not null,
  prompt_version text not null,
  facts jsonb not null,              -- 七个布尔 + 三段凭据 / 理由，字段见下
  last_speaker text not null check (last_speaker in ('customer','us')),
  last_message_at timestamptz,
  source_message_count int not null,
  generated_at timestamptz not null default now(),
  cost_usd numeric(10,6)
);
create index on conversation_facts (client_id, contact_id);
create index on conversation_facts (client_id, generated_at);
alter table conversation_facts enable row level security;
create policy conversation_facts_service on conversation_facts
  for all to service_role using (true) with check (true);   -- 必须写 TO service_role，见 CLAUDE.md §7
```

- `facts`：`{is_spam_or_unrelated, customer_gave_specifics, we_gave_price, next_step_arranged, ordered_or_paid, we_declined, customer_said_not_now, decline_quote, customer_quote, our_quote, progression, reason}`——就是 `scripts/probe-intent-calibration.ts` 里 `VerdictSchema` 那一套，**同一份 schema、同一份提示词**，不另写一份。
- **凭据原话含客人原文**：表只能 service_role 读，API 返回时**不下发** `customer_quote / our_quote`，只下发布尔和 `reason`。
- 只有一行 / 会话，覆盖写；不留历史（审计靠 `generated_at` + `source_message_count`）。
- 迁移文件 `supabase/migrations/20261010xxxxxx_conversation_facts.sql`；不 apply，按规矩由 PM 回「合」后走正常发布流程。

### 2.2 谁来写：挂在已经在跑的每小时任务上，不新注册 cron

照 `qualifiedBuyers` / `stageInfer` 的现成做法（`src/lib/messenger/brief-cycle.ts` 末尾的并列步骤）：新增 `inferConversationFacts(now)`，理由同 `stage-infer.ts` 头注——新 cron 要手工 link 密钥环境变量组，漏了就静默 401（daily-cron-digest 哑了 51 天）。

- **候选**：`conversations` 里 `client_id` 在开关名单内、且（没有 facts 行，或 `last_message_at > facts.generated_at`，或 `source_message_count` 变了）。
- **限流**：每轮最多 20 段、每天最多 80 段（读 `generated_at >= 今天` 的行数）、单段 20 秒超时（沿用 `PER_CANDIDATE_BUDGET_MS`）。
- **预算闸**：当月 `sum(cost_usd)` 超过 `CRM_FACTS_MONTHLY_USD`（默认 15）→ 本轮不跑并在 cron 摘要里报 `budget_exceeded`；账户级失效（余额耗尽 / 钥匙失效）走 `getOpenAIClient` 已有的拦截。
- **开关**：环境变量 `CRM_FACTS_CLIENT_IDS`（逗号分隔，默认空 = 全关）。NAL 先开；别的客户不开，因为提示词里的「具体货物」是物流语义（见 2.5）。
- **失败路径**：模型没答 / 解析失败 / 留痕写不上 → 记一笔 failed，不写半截行；下一轮自然重来。**不吞错**：cron 摘要里带 `{candidates, asked, written, failed, skippedBudget}`（上一轮校准脚本的教训：吞掉的错会变成「整页正常、全员没有」）。
- **这是内部写，不是对外副作用**（不发消息、不扣客户的钱、不改客户资产），所以按 CLAUDE.md §3 Inngest 条款的例外处理：仅内部表写入 + 本任务已有 cron 回执。PR 里要写这句。

### 2.3 谁来读：名单排序

`src/lib/crm/next-action.ts` 加一个纯函数 `priorityTier(seg, facts)`，返回 `0 约好回电 | 1 欠报价 | 2 客人在等 | 3 其余 hot | 4 其余 cold`。`listOf` 的规则变为：**既有分段进 hot 的仍在 hot；分段在 cold、但 `priorityTier ∈ {1,2}` 且没说不要 / 做不了 / 垃圾的，升进 hot**。只往上升、不往下压（2026-08-02 教训，测试照旧穷举）。

- `contacts` 路由三条路径照 `loadLatestBriefByContact` 的方式并行多取一次 `loadFactsByContact(clientId)`（整批取、内存连表；一人多段对话取 `last_message_at` 最新那段）。
- `RankedContact` 加 `facts: FactsLite | null`（只含布尔 + `lastSpeaker`，**不含凭据原话**）。`facts === null`（没跑过 / 开关关）= 行为与今天完全一致。
- 行上的理由：`欠报价` →「客人把货说清了，我们还没报价」；`等我们回` →「客人最后一句话没人回，已经 N 天」。这两句是**事实陈述**，不替 AI 背书；点开侧栏仍可看到凭据原话。
- 排序：`tier` 升序，同 tier 内「最近有动静的排前」（沿用 #2421 已定的规则）。

### 2.4 测试

- 穷举：每个 `Segment` × `{facts=null, 欠报价, 等我们回, 说不要, 垃圾}` 都落进 hot 或 cold，且 hot + cold = 输入总数；
- `facts=null` 时与现有排序逐字一致（回归）；
- 「说不要 / 做不了 / 垃圾」的人绝不被升进 hot；
- 候选选择：没 facts / 有新消息 / 消息数变了才重读；已最新的不读；
- 预算闸：超月上限不调模型；超日上限不调模型；
- 写入失败不留半截行；
- `facts` 的凭据原话不出现在 contacts 路由响应里（断言响应 JSON 里没有 `customer_quote`）；
- RLS：迁移文件里每条 policy 都带 `TO service_role`（用现有的迁移静态检查）。

### 2.5 平台化 / 换客户测试

- **共享**：表、读写任务、`priorityTier`、七个布尔的 schema。
- **行业语义**：「客人给了具体货物」「我们报了价」是**物流 / 贸易**语义；旅游客户对应的是「给了线路 + 出行月份 + 人数」。提示词里这一句要从客户配置读（`leads_config.facts.specificsHint`），不写死在共享代码里；NAL 的值作为默认配置随迁移写入，CTS 不开。
- **换客户测试**：换成 CTS（旅游）——开关默认关，`facts=null`，行为与今天一致；要开必须先配 `specificsHint`。换成悉尼地产客户——同上。
- **client-specific**：开关名单、每月预算上限、`specificsHint`。

### 2.6 已知取舍

1. 事实由便宜模型产出，同一段对话重读可能变（上一轮实测：换成更强模型 + 固定输出后两遍一致 96%，但 55 段样本偏小）。所以：**更强模型 + temperature 0 + 只在有新消息时重读**，不做定时全量重读。
2. 「我们真人报过价」靠重复度识别固定回复（同一句话出现在 ≥3 段对话里）。库里没有「机器发的」标记；`findCanned` 在候选批内算，批太小时会漏认。生产里要用**该客户全部出站消息**的重复度，不是本批。
3. 邮件对话 NAL 有 38 段、没有 `conversation_briefs`，本方案不依赖 briefs，所以邮件也能读。
4. 分段引擎里「最后说话的是客人但没人回」本来应该进 `replied`：NAL 有 27 个客人停在 31–60 天，是因为我们的回复（Meta 后台 / 手机上）系统没记到触点。本方案用对话表的最后一句判断，**绕开**了这个问题而不是修了它；根因另案。

---

## 三、两审意见与处置（2026-10-10）

两审都判：**不能直接开 PR**。下表是处置，**§一、§二的正文以本节为准**（v0 的写法有几处被推翻）。

| # | 谁 | 意见 | 处置 |
|---|---|---|---|
| 1 | 魏征 必改 | 升上来的 52 个欠报价老客会占满 20 个名额，刚来消息的新鲜客人被挤到分界线后面 | **采纳**：升上来的人**每天最多占 5 个名额**，且只升「30 天内有动静」的（NAL 实测 17 人）；其余 15 个名额照现有排序（最近有动静的排前）。5 和 30 天是我的建议值，**PM 可改** |
| 2 | 魏征 必改 | 「欠报价」靠两个布尔，从没验过有没有「不该」；PM 16 个标注全是「该」 | **采纳，并已先做**：重跑审计（52 → 53 人，其余组人数几乎不变，说明数字稳），从「欠报价」组按稳定哈希抽 10 个给 PM 标。**我自己先读了一遍，10 个里至少 3 个明显不对**：一条是 Facebook 的蓝标营销群发（被当成「客人给了货」）、一条是别的公司来问「你们每天订单量多少」的推销、一条是我们刚问「要不要继续发货」、球在客人那边。**所以这一关必须过了才能做** |
| 3 | 魏征 必改 | B 组（客人最后说话，27 人）大概率是误报：24 人停在 31–60 天，多半是在 Meta 后台 / 手机上回过、系统没记到 | **采纳**：**砍掉 B 组**，本方案只做 A 组。根因（系统看不见我们在别处的回复）另案查 |
| 4 | 魏征 必改 | 固定回复识别只在脚本里、按批次算；生产换全量口径数字会变 | **采纳**：先把 `findCanned` 等搬进 `src/lib/crm/`，用该客户**全部**出站消息算重复度；用生产口径重跑审计后再定数字（PR1 的第一步） |
| 5 | 子牙 必改 | 日上限 / 月预算被并发穿透：任务有 Inngest 与 cron 两个入口，Inngest 还会重试；读后判断会同时读到「还剩 5 次」 | **采纳**：读前**占位**——先 `insert … on conflict do nothing` 一行 `status='pending'`（主键 = 对话 id）抢占，抢到的才调模型；日计数用 `(client_id, day)` 的原子递增（upsert + 条件更新）。**砍掉月预算闸**（魏征：80 段 × 30 天约 8 美元，15 美元的闸永远触发不了；有日上限就够） |
| 6 | 子牙 必改 | 同步步骤跑 20 段 × 20 秒会撞网关线（约 125 秒） | **采纳**：每轮**最多 5 段**，总时间预算抄 `CHUNK_TIME_BUDGET_MS`，带 `AbortSignal` |
| 7 | 魏征 建议 | 失败不计数：超长或解析失败的对话每小时重试一次，一天 24 次 | **采纳**：失败写 `status='failed'` + `retry_after = now + 6h`，6 小时内不重试 |
| 8 | 子牙 必改 | 「内部写，按例外处理」站不住（会重复调用付费 AI） | **采纳**：改写为「已在 Inngest 函数内（`messenger-brief-after-sync` 的 sweeps 步骤，也被 hourly cron 调用），回执 `{candidates, asked, written, failed, skippedBudget}` 落在 cron 摘要 / 回执表，不对外发任何东西」；PR 里写明 |
| 9 | 子牙 必改 | `specificsHint` 配置路径不存在，且不该在迁移里按客户写业务配置 | **采纳（魏征同向）**：**砍掉**。只开 NAL，提示词里「具体货物」那句写死并加注释「开第二个客户时再抽成配置」；开关走环境变量 `CRM_FACTS_CLIENT_IDS`（默认空 = 全关），在 `docs/ENV.md` 登记 |
| 10 | 子牙 必改 | 升级规则必须明确哪些分段不升 | **部分采纳**：`excluded`、`nurture_future` **绝不升**；`stale_conversation` 与 `handoff_sop` 可升（PM 盲测里躺在 `handoff_sop` 的「一个集装箱、青岛到利特尔顿、我们只回了固定欢迎语」那位，PM 回了「该」，不升就看不见他）。子牙把 `handoff_sop` 当「转人工」不让升，我没采纳，理由就是这个样本；已要求测试里单列这一条 |
| 11 | 子牙 建议 | RLS 要补 `revoke all … from anon, authenticated`；API 只下发布尔 + `last_speaker`，`reason` 也可能带原话 | **采纳**：迁移照 `20261006100000` 的模板；读路径只 select 布尔列（布尔拆成独立列，不拉 jsonb），响应里不含 `reason` / 任何 quote |
| 12 | 魏征 / 子牙 | 一人多段对话取最新 / 邮件 38 段 / 月预算 | **砍**：NAL 现在够用；邮件 PM 没提，且子牙指出邮件在 `contact_touchpoints` 而不是 `conversations`，我稿里「38 段邮件在 conversations」没核实，先不读 |
| 13 | 子牙 建议 | 拆两个 PR | **采纳**：PR1 = 迁移 + 写任务（A 级，草稿，只写不读，名单行为零变化）；PR2 = 读取 + 排序（`facts=null` 时与今天一致，B 级，可单独回滚）。PR1 先上线跑一周，看 facts 质量再决定 PR2 |
| 14 | 魏征 建议 | 「facts=null 一致」「没人消失」只有测试名没有防线 | **采纳**：`listOf` 在 facts 为 null 时**早退**，用现有排序快照钉死；加断言「hot + cold = 输入总数，且改前在 hot 的每个人改后仍在 hot」 |
| 15 | 魏征 建议 | 96% 一致率来自 55 段样本，别写成稳定事实 | **采纳**：校准文档与本稿都按「方向对、样本小」写；PR1 上线后每周抽 20 段复核 |

## 四、最小版本（v0.2 实际要做的）

- 只开 NAL；只读对话表里的私信 + WhatsApp 对话；
- 只存七个布尔 + 最后一句是谁说的；每轮最多读 5 段、每天最多 80 段、失败 6 小时不重试、读前占位；
- 只做「欠报价」（A 组）一种升级：`stale_conversation` / `handoff_sop` 里、30 天内有动静、客人给了具体货物、我们真人没报价、客人没说不要、不是垃圾 / 推销的人，**每天最多占 5 个名额**；
- 不动意向档、不动 `conversation_briefs`；
- 两个 PR，PR1（只写不读）先上线观察。

**闸门一（做不做）**：PM 标 10 个样本，**没有「不该」，或「不该」都是已知可挡掉的类型（营销群发 / 推销），才继续**。
