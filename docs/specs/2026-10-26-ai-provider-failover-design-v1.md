# AI 供应商自动切换 设计稿 v1（已吸收子牙 + 魏征两审）

**日期**：2026-10-26 · **v1 吸收两审**：架构审 + 挑刺审各一轮，共 9 条必改，全部核实成立 · **提出**：Ray（「openai 如果今后没有 credit 后，是否可以自动更换到 deepseek 和 claude」）
**优先级**：P0（按 §11：频率 高 / IMPACT 闭环关键度 高 / 收入关联度 高 → 零低三高）
**风险级别**：B（共享业务逻辑 + 外部调用；不碰鉴权、库表结构、钱的流向）

---

## 1. 为什么要做（全是查出来的事实，不是推测）

| 事实 | 证据 |
|---|---|
| OpenAI 这个月断了 **8 天** | `provider_outages` 表：10-11、10-12、10-13、10-18、10-19、10-20、10-21、10-25 |
| 断了就是整片 AI 功能空转 | 2026-10-25 20:19 手动触发简报：`candidates:25, generated:0, failed:3, aborted:"余额/额度用光"` |
| 台账记下来了，但没能让 PM 及时动手 | 10-21 开的卡 `2026-10-25-...no-credit`（verify_by 10-24）到 10-26 仍未解决，PM 是在对话里被告知才充值 |
| 充值后立刻恢复 | 同一个接口 20:31 再触发：`candidates:25, generated:25, failed:0`，25 张卡全挂在邮件对话上 |

**结论**：这不是偶发，是每周都撞上。光报警不够 —— 报警已经有了，而且响了 8 次。

## 2. 平台上已经有什么（Reuse First，查了三处）

- **代码**：`src/lib/ai/openai-client.ts`（OpenAI 统一入口 + 拦截 + 落断电台账）、
  `src/lib/anthropic/client.ts` + `src/lib/ai/model-router.ts`（Claude Sonnet/Haiku 分层）、
  `src/lib/agent-learning/llm/deepseek-client.ts`（DeepSeek 运行时客户端，带官方价格常量）、
  `src/lib/ai/provider-failure.ts`（把报错分类成「账户级断电 / 要人管 / 可重试」）、
  `src/lib/ai/outage-ledger.ts` + `provider_outages` 表（按天记一行）
- **在飞 PR**：`gh pr list` 搜 openai/credit/额度 → 没有人在做
- **台账**：`2026-10-25-openai-account-no-credit`（同一会话 10-21 开的，钱的事待 PM；现已充值）

**缺的只有一件**：没有「供应商无关」的调用层，所以没地方放切换。38 个文件直接拿 OpenAI 客户端用，各自写各自的请求格式。

## 3. 客户数据边界（v1 更正：v0 这一节写过头了）

DeepSeek 是中国公司。**先例是真的**（核实过：`telephony_call_analyses` 最近 6 条全是 `deepseek-chat`，
最新 10-22，Render 上 `DEEPSEEK_API_KEY` 已配）。**但范围不一样**：先例只涉及 CTS 一个客户的通话转写
（且台账卡 `2026-10-12-cts-call-transcribe-via-twilio` 仍是 `decided`、CTS 书面同意还没拿到）；
简报要喂的是**全部客户的全部私信和邮件原文**。v0 说「不构成新的隐私决定」是错的 —— 范围大了一个数量级。

**所以 v1：DeepSeek 接口留好、默认关着。** 开关 `AI_FAILOVER_ALLOW_DEEPSEEK=1`，不设就永远不会把客户内容发给它。
是否打开是 PM 的决定（客户的真实情况 + 风险接受度），不是技术问题。**Claude 这一层先上线，已经解决 8 天断电的 100%。**

## 4. 做什么（v1：吸收两审后的契约）

新建 `src/lib/ai/failover.ts`，只提供一件事 —— **「按这个格式回答我」**：

```ts
export interface AskJsonArgs<T> {
  system: string
  user: string
  /** 唯一的格式定义。json_schema 由它生成；校验用同一把尺子（见 4.4） */
  schema: ZodType<T>
  /** OpenAI 的 json_schema 原文（带给模型看的 description）。见 4.4 */
  jsonSchema: { name: string; schema: unknown }
  /** 整次 askJson 的**总**预算，不是单家的（见 4.2） */
  signal?: AbortSignal
  totalBudgetMs: number
  /** brief.ts 现在传 true：responses.create 从没走过 CF 网关，不拿零证据的路由换在跑的链路 */
  bypassGateway?: boolean
}
export interface AskJsonResult<T> { data: T; provider: 'openai' | 'anthropic' | 'deepseek'; model: string }
export class AllProvidersFailedError extends Error {
  /** 每一家为什么失败。调用方据此判断要不要「当场停下」（见 4.3） */
  kinds: Partial<Record<Provider, ProviderFailureKind>>
}
```

### 4.1 顺序、冷却与自愈

顺序 **OpenAI → Claude Haiku →（DeepSeek，默认关）**。

**跳过判据不用 `provider_outages` 表**（挑刺审 P0）：那张表的语义是「给人看的历史、最近 N 天出现过」，
拿来做路由就整个反了 —— 充了钱当天 OpenAI 仍被跳过，症状为零、没人知道钱白充了。
改用 `failover.ts` 自己的**进程内短冷却**：某家命中账户级失败（没钱/钥匙不认）后冷却 10 分钟，
冷却到点自动再试一次，通了就恢复。**宁可每 10 分钟多吃一个 429，也不要充了钱用不上。**
所有家都在冷却时：不发任何网络请求，直接抛 `AllProvidersFailedError`（这就是熔断 —— 账户级全挂时不再烧时间）。

### 4.2 预算与重试（魏征 P0：这条不改，切换在生产上一次都不会生效）

事实：OpenAI 断电时单家要吃 20.1 秒（SDK 对 429 重试两次），而一条候选的总预算是 20.0 秒 ——
第一家吃完整个预算，Claude 连发出去的机会都没有，运行记录跟 10-25 那天一模一样，还让人以为「切换已经做好了所以不可能是没钱」。

- **每一家必须 `maxRetries: 0`**（SDK 重试在切换语境下是纯损耗）。
- **每一家只拿剩余预算的 1/剩余家数**：第一家失败得快，剩下的全给下一家；失败得慢，也给后面留着。
- Anthropic 用 SDK 直连（`getAnthropicClientDirect` + `maxRetries: 0`），**不用** `callClaudeChat` 的非 singleAttempt 路径 ——
  那条会在 SDK 报错后再用原生 fetch 打一遍，每次失败翻倍。
- 总次数上限 **4**：Zod 不过只给**第一家**重试一次，后面的家各一次。

### 4.3 错误必须带得出判据（架构审 P0 + 挑刺审 P1）

`brief-cycle.ts:565` 靠 `generateBrief` 抛 OpenAI 原始异常才能 `classifyThrownOpenAIError → needsHuman →` 当场停下整轮。
聚合错误会被判成 `other` → 整轮不停，500 条 × 4 次慢慢烧，PM 那句「余额用光，已当场停下」不再出现。
所以 `AllProvidersFailedError.kinds` 必须带每家的分类；**刀 2 必须在同一个 PR 里**让 brief-cycle 认得它
（凡是尝试过的家全是账户级失败 → 按账户级处理，当场停下）。`!apiKey` 那道门同步改成「所有启用的家都没钥匙才兜底」。

### 4.4 一把尺子，不要两把

校验用的 Zod 不能比 json_schema 宽（现在 Zod 有 16 个 `.default()`，手写 json_schema 全字段必填）——
否则 DeepSeek 只答 3 个字段就能过关、其余自动填空，一张「摘要有、需求承诺全空」的卡被当成成功。
`askJson` 校验前先用**无默认值的严格版**过一遍，并加非空闸（summary 去空白后非空）。
不开 OpenAI 的 `strict: true`（现在也没开，v0 写「严格模式」是错的）。

### 4.5 记账与可见性（魏征 P0）

- Claude / DeepSeek 失败也要落 `provider_outages`（表的 `provider` 是纯文本，设计时就留给了别的供应商，**不用改库表**）。
  否则切到 Claude 之后 Claude 也没钱，会静默滑到下一家，台账上永远只有 openai。
- 失败转移成功时给 `detail` 加前缀「已自动切到 X」—— PM 待办里那句「全站 AI 可能在安静地跳过」在切换成功时不成立，会变成狼来了。
- **`conversation_briefs.model` 必须写真实答题的模型**。现在 `brief.ts:634` 写的是 `process.env.OPENAI_API_KEY ? modelName() : 'fallback'`
  —— 凭环境猜的，断电时钥匙还在，照样写 `gpt-4o-mini`。而且这一列**只写不读**，人看不到。
  刀 2 要把它改对，并在 `provider !== 'openai'` 时下发一条 PM 待办：「今天有 N 张卡是备用模型答的，要重点抽查」。

### 4.6 备用模型守不守规矩（刀 1 当场试跑查出来的，v1 初稿里没有）

拿 8 段真实 CTS 邮件对话，同一份提示词、同一个简报格式，让 Claude Haiku 答：

| | summary 和 next_action 都是中文 | 平均耗时 |
|---|---|---|
| 不加提醒 | **5 / 8** | 6.7 秒 |
| 末尾加一句语言提醒 | **8 / 8** | 6.7 秒 |

OpenAI 在同样对话上 3/3 全中文，耗时 3–4 秒。结论：

- **格式对 ≠ 能用。** 提示词要求「一句话/下一步写中文」，格式校验完全看不出 Claude 写成了英文。
  所以 `askJson` 加了 `backupSystemSuffix`：**只追加给备用模型**，主力 OpenAI 的提示词一字不变。
  后缀内容是调用方的事（切换层不知道简报要中文，换个场景就是别的要求）。
- 刀 2 的简报校验要加**语言闸**（summary / next_action 必须含汉字），否则 3/8 的英文卡会被当成功写进库。
  闸不过的算 `schema_invalid`：**第一家**会重试一次，备用家不重试 —— 备用家拿到的是剩下的预算。
- Claude 比 OpenAI 慢一倍（约 6.7 秒 vs 3–4 秒）。20 秒候选预算下，OpenAI 瞬间失败 → Claude 独得约 19 秒，够用；
  但 OpenAI **慢失败**（吃掉一半预算 10 秒）→ Claude 只剩 10 秒，仍够一次。刀 2 的 `PER_CANDIDATE_BUDGET_MS` 不改也行，
  但 `BRIEFS_PER_CHUNK = 12` 是按「每张 3.2 秒」算的，切到 Claude 后每段要多花一倍时间 —— 刀 2 必须重核。

## 5. 分几刀

- **刀 1（本 PR）**：`failover.ts` + 三家适配器 + 测试。**不接任何调用方，线上行为零变化。**
- **刀 2**：接 `brief.ts` + `brief-cycle.ts`（4.3 的错误契约、上调 `PER_CANDIDATE_BUDGET_MS` 并重核 `BRIEFS_PER_CHUNK`）+ 4.5 的落库与待办。
  **当场试跑必须走真实 `generateDueBriefs`、带 20 秒真实候选预算**，证据是库里那一行（`conversation_id` + `model` + `generated_at`），不是「我看到了」。
- **刀 3 起**（另开台账卡）：其余 5 个 json_schema 调用点；32 个纯文本调用点。
  架构审提议：纯文本那 27 个 `chat.completions` 调用点，DeepSeek 原样吃，换个地址就能切，比逐个改便宜得多 ——
  但它等于把更多客户内容发给 DeepSeek，**须等 PM 对第 3 节点头**。

## 6. 明确不做

- 不做「按价格自动选最便宜的那家」—— 那是省钱，不是防断电，会把输出质量变成随机的。
- 不做自动充值、不碰账单。
- 不改每次调用喂给模型的内容。
- 不给 38 个调用点一次性换血。
- **不接线 DeepSeek（默认关）**，等 PM 对第 3 节的数据范围点头。

## 7. 怎么验收（v1：每条都要有第三方可核验的痕迹）

1. 单测：三家各自成功 / 失败 / 全失败 / 第二家救回来 / Zod 不过只给第一家重试 / 冷却到点自愈 / 全家冷却时零网络请求。
2. **变异测试**（每条都必须有测试变红）：去掉 `maxRetries:0`、去掉「每家只拿 1/剩余家数」、去掉冷却、去掉冷却自愈、
   去掉严格校验、去掉非空闸、DeepSeek 开关默认值改成开、`AllProvidersFailedError` 不带 kinds。
3. **回归钉**：现有的「账户级故障当场停下」（`brief-cycle.ts:565`）必须有测试在刀 2 前后都绿。
4. **当场试跑（刀 2）**：走真实 `generateDueBriefs`，带 20 秒真实候选预算，把 OpenAI 钥匙在本地换成无效值，
   证据贴 PR：那条 `conversation_briefs` 行的 `conversation_id` / `model` / `generated_at`。
5. **「不该跳的时候不跳」**：冷却到点后 OpenAI 必须被再试一次 —— v0 只验了「该跳时跳」，验的是坏方向的那一半。
6. 线上：刀 2 合并后手动触发一次，`generated > 0`，库里读得出是谁答的，PM 待办里能看到降级提示。

## 8. Reuse Statement

- **复用**：`provider-failure.ts` 的分类、`outage-ledger.ts` 与 `provider_outages` 表、
  `anthropic/client.ts`、`agent-learning/llm/deepseek-client.ts`、`model-router.ts` 的 Haiku 定价。
- **新增且真属平台共享**：`failover.ts` 这一层（跨客户、跨行业，无客户语义）。
- **行业/客户特有**：无。不读 `clientId`，不读任何客户配置。
- **有没有把客户事实写进共享代码**：没有。喂什么内容由调用方决定，本层只管「谁来答」。

## 9. 刀 1 的真实证据（2026-10-26）

- 单测：`failover-core.test.ts` 23 条 + `failover.test.ts` 23 条。
- 变异：核心 11 组 + 适配器 13 组 + 后缀 3 组，**全部被抓到**。
  核心的头一轮有 2 个漏网，恰好是最关键的两个（按剩余家数切预算、识别超时）：
  原因是测试用了手拨的假时钟，「前一家吃掉多少预算」在测试里根本不存在 —— 改用真时钟后才抓到。
- 真实对比：8 段真实 CTS 邮件对话，OpenAI 与 Claude 各答一遍（见 4.6）。**Claude 的强制工具调用路径在生产格式上真的通了。**
- 没做：没有用「无效钥匙」去触发真实的 OpenAI 断电 —— `openai-client.ts` 的拦截点会把它写进生产
  `provider_outages` 并触发 PM 待办，一次试验会造出一条假断电。OpenAI 失败用注入的假错误模拟，Claude 用真调用。

## 10. 刀 2 的真实证据（2026-10-26）

**走真实 `generateDueBriefs`、带 20 秒真实候选预算**，在网络层把 OpenAI 拦截成「余额用光」（HTTP 429
insufficient_quota），往 `provider_outages` 和 `conversation_briefs` 的写入也拦下来记录
（既不往生产库写假数据，也不在断电台账里造假断电；那就是「本该写进库的那一行」），其余全部真调用：

| 渠道 | 候选 | 结果 | 耗时 | OpenAI 被打次数 | 落库的 model |
|---|---|---|---|---|---|
| 邮件 | 3 | generated 3 / failed 0 / aborted null | 23 秒 | **1** | `claude-haiku-4-5-20251001` |
| 私信 | 3 | generated 3 / failed 0 / aborted null | 18 秒 | **1** | `claude-haiku-4-5-20251001` |

- **OpenAI 只被打了 1 次**（3 条候选）：第一条失败后冷却生效，后面直接走 Claude；`maxRetries: 0` 也生效
  （不关的话同一条会被 SDK 重试 3 次）。
- 台账里本该多一行 `openai / account_exhausted`，一行，不是三行。
- 6 张卡的一句话和下一步全是中文；`model` 如实记的是答题的 Claude，不是凭环境变量猜的 `gpt-4o-mini`。
- 第一轮选样本时我挑了 2 条没存消息的私信（`last_message_at` 为空，生产挑人逻辑本来就不会选它们），
  结果 5 条候选只出 3 张。是我选样本的错，不是切换层的问题，换成有消息的私信后补验了一遍。

### 单测与变异

- 第二刀新增：`brief-failover`（10）、`brief-cycle-failover`（9）、`brief-schema-strict`（12）、`provider-outage-backup`（11）。
- 变异 20 组全部抓到（含 DeepSeek 修复的 4 组）。其中一个漏过：「Claude 钥匙不认也指向充值页」—— 我的断言只验了域名是 anthropic.com，
  而钥匙页和充值页都是这个域名；加严成分别断言 `/keys` 和 `/billing` 后才抓到。

### 没做 / 已知

- 降级提示并进了「该充值了」那条待办，没有另起一条（PM 9-26 定过：告知挪周报、待办只留需要动手的）。
  代价：如果当天那条提醒因为提醒节奏被压住，降级张数也不会出现。
- `BRIEFS_PER_CHUNK = 12` 没改。切到 Claude 后每张 6~8 秒，12 张贴着 90 秒的段预算，由预算闸提前收段，
  只是切换期间每段少写一两张。注释已更新。
### DeepSeek：单测全绿，真实调用却 5/5 全败 —— 这是整件事里最值得记住的一条

PM 10-26 点头开了 DeepSeek 之后，我拿 5 段真实 CTS 邮件对话让它**单独**回答（严格格式校验 + 语言闸）：
**5 条请求 5 条 HTTP 400**。单测里的假客户端永远不会 400，所以 46 条测试一直是绿的。

根因（直接问 DeepSeek 拿到的原文：`Prompt must contain the word 'json' in some form to use 'response_format' of type 'json_object'`）：

1. `json_object` 模式要求提示词里**必须出现 "json" 这个词**，否则一律 400；
2. 它只保证返回合法 JSON，**不认识我们的格式**（第二条探测请求它自己编了一个结构）——
   OpenAI / Claude 靠 API 参数拿格式，DeepSeek 只能靠提示词，所以必须把 schema 原文写进提示词。

修完后同样 5 条（加到 6 条）：**6/6 通过严格格式 + 语言闸，平均 3.6 秒**（跟 OpenAI 一样快）。

**连带暴露的设计问题**：这个 400 会被判成 `request_invalid`（调用方写错了）→ 立即抛出、不再试后面的家。
但**备用家**的 400 更可能是适配器跟它不兼容，不是调用方的错 —— 为此放弃剩下的家，
等于把一个适配器缺陷升级成全线停摆。改成：只有**第一家活跃的**供应商返回 `request_invalid` 才立即抛；
备用家的记下来、继续试下一家（也不进冷却：不是账户问题）。
