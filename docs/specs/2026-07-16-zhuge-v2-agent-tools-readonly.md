# 诸葛亮 v2：从「单步拍板」到「会调查再拍板」的多步 Agent

> **Spec 状态**：v0.2（子牙起草 · 魏征/板桥已审 · **狄仁杰安全审已过 → 已纳入 A–F 条款**）
> **狄仁杰裁决**：方向对、底子好，但 v0.1 把「跨客户隔离」窄化成「不让 Claude 传 client_id」；真实越权轴有 **4 条**（client_id / domain / site_url / property_id），且 `fetchOutcomeConfidenceMap` 本身查全表。v0.2 已把安全模型从「client_id 作用域」升级为「**资源身份强作用域**」，见 §3.3。
> **日期**：2026-07-16 NZST
> **DAPE 段**：**P**（Prescription / 战略决策）
> **6 支柱**：横切（seo / ai_visibility / ads / social —— reputation/competitor 不接飞轮，工具不覆盖）
> **双轨**：self-serve（short 模式）+ FDE（long 模式），共用同一 conductor
> **AI memory**：不改现有 3 层 memory 接线，工具是「取一手数据」而非「取记忆」

---

## 0. TL;DR（给不读代码的人）

诸葛亮是 ME 后台定战略优先级的「军师」——先打哪条战线、钱砸哪、哪个 Goal 主攻。它现在的毛病是：**看一眼华佗给的诊断分（"seo: 42/100"）就拍板，拍板前不能自己回源去查"这 42 分背后到底是哪几个关键词掉了、掉了多少、上次类似动作效果如何"**。它在二手摘要上做决策。

这次改造：给诸葛亮装上 ME **已经自研好的多步工具循环能力**（`callClaudeWithTools`，张骞/鲁班都在用），挂 4 个**只读**工具，让它决策前能自己下钻查一手数据，出更靠谱的 work order。

**不碰第三方托管**（不用 OpenAI Agent Builder），能力全在 ME 自己后台，数据全落 Supabase，护城河不动。

---

## 1. 背景：为什么是诸葛亮，不是华佗

PM 痛点原话：「ME 后台缺聪明的 Agent」。子牙初判「第一刀砍华佗」，**被魏征 + 板桥两路独立复审推翻**，收敛结论如下。

### 1.1 四 agent 现状（实测）

| Agent | DAPE 段 | 是不是真·多步 | 事实 |
|---|---|---|---|
| 张骞 Discovery | D | ✅ 强 | `zhangqian/agent.ts` 完整 tool loop，10+ 工具，18 轮 |
| **华佗** Analysis/处方 | A/P | ⚠️ 半个 | 多阶段（并行预取 5 源 → 生成 → 7 维自评 → 精修），但**无 tools 参数** |
| **诸葛亮** Strategy | **P** | ❌ **单步** | `zhuge/conductor.ts` 用 `callClaudeChat` 一次调用，静态拼 prompt，**决策目标就是这次改造** |
| 鲁班 Execution | E | ✅ | `luban/agent.ts` 用 `callClaudeWithTools`，6 轮 |

### 1.2 为什么砍诸葛亮而不是华佗（三方共识）

- **华佗任务形态不吃 tool loop**（魏征）：处方生成需要的数据面是**固定可枚举的**（基准/趋势/案例/置信度），华佗已在 Step1 `Promise.all` 并行预取 5 源（`fetchBenchmarks` / `getDomainTrafficHistory` / `getIndustryInterestTrend` / `retrieveSimilarCases` / `fetchOutcomeConfidenceMap`）。给它挂 tool loop 边际收益低，还要拆 self-grade 闭环、成本翻 3-5 倍、踩 max_tokens 截断洞。
- **华佗改了客户零感知**（板桥）：客户看的是处方结论对不对，不关心它中途多查了几次。纯后台工艺升级。
- **诸葛亮才是真短板**（两方一致）：它是 DAPE 的 P 段核心，**在华佗嚼过的二手摘要上拍板**，缺口最大、改造面最小（单步→loop，无 self-grade 冲突）、杠杆最高（**诸葛亮拍歪会污染下游所有处方**）。补最短的板，不是把最长的板磨更亮。

### 1.3 关键洞察：诸葛亮在二手信息上决策

`conductor.ts` 的 `buildUserPrompt` 只喂：
- `formatScores` → 6 维 0-100 数字（`seo: 42/100`）
- `formatFindings` → finding 标题（`[HIGH] seo/xxx: 标题`），**无底层 metric 明细**
- `formatEvidenceSummary` → 张骞证据快照摘要

诸葛亮**拿到分数，看不到分数背后的一手数据**。给它工具回源下钻，是**质变**，不是锦上添花。佐证：`proactive.ts` 已经有 `dismissed_keys` 确定性安全网覆盖 LLM 决策——说明诸葛亮团队早就意识到「LLM 决策需真实数据兜底」，给它工具正好把这诉求正规化。

---

## 2. 目标 / 非目标

### 2.1 目标

1. 抽 **`src/lib/agent-tools/readonly/`** 共享只读工具集（标准 `{ tool, handler }` 对），四 agent 将来共用——这是所有大脑变聪明的**公共地基**。
2. 补 `callClaudeWithTools` 的 **max_tokens 截断洞**（红线：诸葛亮输出 JSON，静默截断 = 坏 work order）。
3. 诸葛亮 conductor 从 `callClaudeChat`（单步）改为 `callClaudeWithTools`（多步），挂 4 个只读工具。
4. **🔴 client_id 强作用域**：所有只读工具的 handler 在**服务端闭包里绑定当前 client_id**，Claude 的工具入参**不接受 client_id**，无法查到别的客户数据。
5. 工具调用轨迹（`tool_calls`）**落库**，符合「数据全留存 ME 容器」护城河。

### 2.2 非目标（明确不做）

- ❌ **华佗先不动**。将来真要补，用轻量「self-grade 发现缺某维度数据 → 触发一次定向 re-lookup」，复用现有多阶段骨架，**不上全套 tool loop**。
- ❌ 不引入 OpenAI Agent Builder / 任何第三方 agent 托管。
- ❌ 不新建数据库表（v1 用现有 jsonb meta 落 tool trace）——**规避 PM migration 关卡**。
- ❌ 不改 3 层 memory 接线。
- ❌ 不扩到 reputation/competitor 维度（FDE 外部处理，不接飞轮）。

---

## 3. 架构设计

### 3.1 共享只读工具集 `src/lib/agent-tools/readonly/`

```
src/lib/agent-tools/readonly/
  index.ts              # buildReadonlyTools(ctx) → { tools, handlers }
  types.ts              # ReadonlyToolContext { clientId, domain, supabase, market }
  keyword-detail.ts     # query_keyword_detail  → 包 dataforseo/labs + domain-analytics
  search-console.ts     # query_search_console  → 包 gsc/client
  analytics.ts          # query_analytics       → 包 ga4/client
  flywheel-history.ts   # query_flywheel_history → 包 case-library/outcome-confidence + flywheel_actions 表
```

**核心工厂签名**（client_id 绑死在闭包里，见 §3.3）：

```typescript
// index.ts
// 🔴 ctx 承载「全部资源身份标识符」——4 条越权轴全部服务端注入，
//    工具入参 schema 一律不含它们（见 §3.3）。
export interface ReadonlyToolContext {
  clientId: string           // 越权轴 1
  domain: string | null      // 越权轴 2（dataforseo 按 domain 查）
  siteUrl: string | null     // 越权轴 3（GSC 按 siteUrl 查）— 由 clientId 反查 connector.config
  propertyId: string | null  // 越权轴 4（GA4 按 propertyId 查）— 由 clientId 反查 connector.config
  supabase: SupabaseClient
  market: 'AU' | 'NZ'
}

// 工厂内部先由 clientId 反查该客户的 GSC/GA4 connector config，
// 组出 siteUrl / propertyId，再冻结进闭包。Claude 全程无法指定查哪个站/property/域名。
export async function buildReadonlyTools(ctx: ReadonlyToolContext): Promise<{
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
}>
```

### 3.2 四个只读工具（v1）

| 工具名 | 干什么（Claude 视角） | 包装的真实函数 | 入参（Claude **可传**）| 资源身份（**服务端 ctx 注入**）|
|---|---|---|---|---|
| `query_keyword_detail` | 查某维度低分背后的关键词明细：哪些词、排名、搜索量、KD | `dataforseo/labs.ts` + `domain-analytics.ts`（`getKeywordsForSite` / `getDomainTrafficHistory`）| `{ dimension?, limit? }` | `ctx.domain` 🔴 |
| `query_search_console` | 查 GSC 近 28 天真实点击/曝光/CTR/排名（品牌词、掉词）| `gsc/client.ts::fetchGscSnapshot` | `{ range_days?, filter? }` | `ctx.siteUrl` + `ctx.clientId` 🔴 |
| `query_analytics` | 查 GA4 真实流量/转化/跳出（该战线是否真带来生意）| `ga4/client.ts::fetchGa4Snapshot` | `{ metric?, range_days? }` | `ctx.propertyId` + `ctx.clientId` 🔴 |
| `query_flywheel_history` | 查**该客户**历史动作的归因效果（这招上次灵不灵）| **🔴 新写 `fetchClientOutcomeHistory(supabase, clientId, filters)`**（禁用查全表的 `fetchOutcomeConfidenceMap`）| `{ flywheel?, action_type? }` | `ctx.clientId` 🔴 |

**全部只读**——无 INSERT/UPDATE/DELETE 路径（狄仁杰实读 4 库确认）。handler 内部只调既有 readonly lib 函数 + `supabase.from(...).select(...)`。

> **🔴 狄仁杰硬阻塞条款 A**：`query_flywheel_history` **绝不能包 `fetchOutcomeConfidenceMap(supabase)`** —— 该函数（`outcome-confidence.ts:94`）无 client_id 谓词、**查全表**（华佗用它做跨客户全局基准，语义本就是聚合）。诸葛亮包它 = A 客户跑一次就把 B/C/D 客户 outcome 吃进上下文。必须新写 `fetchClientOutcomeHistory`，SQL 强制 `.eq('flywheel_actions.client_id', clientId)`（参照同文件 `fetchSeoBlogConfidenceByMode` 的正确写法 `outcome-confidence.ts:140`）。

### 3.3 🔴 资源身份强作用域（安全红线 · 狄仁杰审后根本修正）

**v0.1 的错误**：只盯着「不让 Claude 传 client_id」。但狄仁杰实读底层库发现，这些函数的**真实越权轴不是 client_id**——GSC 按 `siteUrl` 查、GA4 按 `propertyId` 查、dataforseo 按 `domain` 查。锁死 client_id 却放开这三个，等于锁了前门开了三扇窗。尤其 `domain` 是**公开信息**，prompt 注入文本里塞一个别客户域名毫无门槛。

**威胁模型（4 条越权轴）**：Claude 是黑盒，可幻觉或被 prompt 注入。**只要工具入参 schema 暴露任一资源身份标识符（client_id / domain / site_url / property_id），Claude 就能把它填成别客户的值**，绕过一切下游过滤。

**设计（升级版三道闸 · 作用于全部 4 轴）**：

1. **闸 1 · 入参零资源标识符**：所有工具的 `input_schema` **一律不声明** `client_id` / `domain` / `site_url` / `property_id`（及任何别名）。Claude 只能传语义参数（`dimension` / `range_days` / `flywheel` / `limit`）——**没有任何切换查询目标客户的入口**。
2. **闸 2 · ctx 闭包绑定全部 4 轴**：`buildReadonlyTools(ctx)` 时，`clientId` 从服务端 `ZhugeInput.client.id` 注入；`domain` / `siteUrl` / `propertyId` **由 clientId 反查该客户 connector.config 组出**，全部冻结进闭包。handler 查询强制用 `ctx.*`，SQL 强制 `WHERE client_id = ctx.clientId`（能带的表都带）。
3. **闸 3 · 防御式忽略**：即便 Claude 在 input 里硬塞了 `domain` / `site_url` 等（不该有），handler **忽略入参里的一切资源标识符字段**，只用闭包的 `ctx.*`。命中即 `console.warn` 告警（观测越权尝试 + prompt 注入信号）。

**🔴 条款 B/C/F（狄仁杰硬阻塞）**：
- **B**：GSC/GA4 的 `siteUrl` / `propertyId` 必须从 ctx 注入（由 clientId 反查 connector.config），入参绝不含。
- **C**：dataforseo 的 `domain` 从 `ctx.domain` 绑定，入参绝不含。
- **F**：GSC/GA4 的**服务账号 fallback 路径**（`GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`）下，一个服务账号可能有多站权限 → siteUrl 一换就真读别站。**在工具语境禁用服务账号 fallback，只走 per-client OAuth token**；或断言 siteUrl 被 ctx 锁死无法变。

**测试要求**（狄仁杰变异三件套 · 每个都要「改坏→测试必 fail」防空架子）：
- ① 伪造 `client_id: '<别客户>'` 入参 → 断言返回仍是本客户数据
- ② 伪造 `site_url` / `property_id: '<别客户站>'` 入参 → 断言查的仍是本客户站
- ③ 伪造 `domain: '<别客户域名>'` 入参 → 断言查的仍是 `ctx.domain`
- 变异：把某 handler 改成用 `input.*` 而非 `ctx.*` → 对应测试必须 fail

### 3.4 补 `callClaudeWithTools` 的 max_tokens 截断洞

**现状洞**（`client.ts:428`）：

```typescript
// end_turn / max_tokens / refusal — 不再用工具，收尾返回
if (message.stop_reason !== 'tool_use') {
  return buildToolLoopResult(...)   // ← max_tokens 截断被当正常结束
}
```

诸葛亮的输出要过 `parseOutput`（jsonrepair），截断的 JSON 会被 jsonrepair 强行补全成**残缺 work order**静默流下去。

**修法**（外科手术，不动现有 end_turn 行为）：在收尾 return 前，`ClaudeToolLoopResult` 增加 `stop_reason` 字段透传；诸葛亮 conductor 侧检查 `if (result.stop_reason === 'max_tokens') throw new Error('conductor 输出被截断')`，让上层重试/降级，而非吞下坏 JSON。

> **注**：魏征原提的「超时洞」经核实**对诸葛亮不是 blocker**——`perCallTimeoutMs` 已是可配参数（默认 60s），诸葛亮输出小（1024-2048 token）60s 充足。超时改造留给未来华佗（需 240s）时再做，本 spec 不含。

### 3.5 诸葛亮 conductor v2 接线

`conductPriorityActions` 改动（最小面）：

```typescript
// 旧：单步
const result = await callClaudeChat({ systemPrompt, messages, maxOutputTokens })

// 新：多步，挂只读工具（buildReadonlyTools 现为 async — 内部反查 connector.config 组 siteUrl/propertyId）
const { tools, handlers } = await buildReadonlyTools({
  clientId: input.client.id,          // 🔴 服务端注入（越权轴 1）
  domain: input.client.domain,        // 🔴 越权轴 2
  siteUrl: null,                      // 🔴 越权轴 3 — 工厂内部由 clientId 反查 connector.config 填充
  propertyId: null,                   // 🔴 越权轴 4 — 同上
  supabase,
  market: input.businessContext.market === 'NZ' ? 'NZ' : 'AU',
})
const result = await callClaudeWithTools({
  systemPrompt,                        // system prompt 加一段「决策前可用工具下钻查证」
  messages: [{ role: 'user', content: userPrompt }],
  tools,
  toolHandlers: handlers,
  maxOutputTokens,
  maxToolRounds: mode === 'short' ? 2 : 4,   // 见 §4 成本控制
})
if (result.stop_reason === 'max_tokens') throw new Error('conductor output truncated')
const top_actions = parseOutput(result.text)
```

**system prompt 增量**：告诉诸葛亮「你可以用工具查一手数据核实低分维度，但工具是**辅助决策**，不是必须每次都调；只在分数存疑或需要归因证据时下钻」。避免它无脑每次跑满工具轮。

---

## 4. 成本 / 延迟 / 确定性控制（板桥重点关切）

板桥警告：别把「快」做坏、别让处方飘忽。对应控制：

| 风险 | 控制 |
|---|---|
| 成本翻倍不可控 | `maxToolRounds`：short=2、long=4（不用默认 6）。system prompt 明示「工具辅助非必调」。工具结果**截断上限**（每个工具 return ≤ ~1500 token，避免把大表灌进上下文）|
| 延迟变长 | 诸葛亮不在客户实时交互链上（它跑在诊断后的策略编排 cron/异步），延迟容忍度 > 鲁班对话。仍设 `maxToolRounds` 上限兜底 |
| 结论飘忽 | 工具让决策**更**基于真实数据（降飘忽），非增飘忽。system prompt 保留现有 8 条 prioritisation framework + memory 约束不变 |
| self-serve 省 token | short 模式 `maxToolRounds=2`，与现有「短模式 0 MTC/省 token」约束一致 |

**成本预估**：long 模式最坏 4 轮工具 + 1 收尾 ≈ 5 次 Claude 调用，每次输入随轮膨胀但工具结果已截断，估 $0.10-0.25/次（vs 现在单步 ~$0.03-0.05）。诸葛亮**每客户每次诊断后跑一次**，非高频，可接受。**实施时加成本日志验证，超预算则降 maxToolRounds。**

---

## 5. 数据留存（护城河）

`callClaudeWithTools` 已返回 `tool_calls: ClaudeToolCall[]`（名称/入参/结果/是否出错）。conductor v2 把它**落库**：

- 塞进 conductor 输出写 `flywheel_actions` 时的**现有 jsonb meta 字段**（key: `conductor_tool_trace`），无需 migration。
- 价值：PM 可追溯「诸葛亮这次拍板前查了什么、看到什么数据」——决策可解释性 + 飞轮 intelligence 沉淀。

**🔴 条款 D（狄仁杰 · 防二次泄漏放大）**：tool trace 落库前必须先按 A/B/C 修好数据源（否则别客户数据会随 trace **永久落进本客户** `flywheel_actions.meta`，未来任何读该行的人/agent 都看到）。此外：
- **不落 `result` 原始全文**，只落 `{ name, input, summary }`（结果摘要 ≤ 200 字），减少泄漏面。
- trace 与工具 return 文本均走**封装名过滤**（CLAUDE.md 硬约束：PM 可见的后台 trace 禁出现 DataForSEO/SEMrush/OpenAI 等真实供应商名）。
- 断言 **token 绝不进 result / trace**（现有 fetch 函数不返回 token，写测试锁死）。

---

## 6. 分阶段实施（每阶段独立 commit）

| 阶段 | 内容 | 验证 |
|---|---|---|
| **S0**（🔴 前置）| 条款 A：新写 `fetchClientOutcomeHistory(supabase, clientId, filters)`（SQL 带 client_id 谓词），**不动**现有 `fetchOutcomeConfidenceMap`（华佗全局基准仍用它）| 单测：断言返回 outcome 全属传入 clientId，无别客户 action |
| **S1** | 抽 `src/lib/agent-tools/readonly/` 骨架 + `types.ts`（ctx 含 4 轴）+ 4 工具定义。**工厂 async，内部由 clientId 反查 connector.config 组 siteUrl/propertyId（条款 B）；domain 从 ctx 绑（条款 C）；GSC/GA4 禁服务账号 fallback（条款 F）** | 单测：每工具 handler 返回真实数据 + **变异三件套**（§3.3：伪造 client_id/site_url/property_id/domain 全部越权无效）|
| **S2** | 补 `callClaudeWithTools` 的 `stop_reason` 透传 + 截断保护 | 单测：mock max_tokens → 断言抛错不静默 |
| **S3** | conductor v2 接线（`callClaudeChat`→`await callClaudeWithTools`）+ system prompt 增量 + tool trace 落库（条款 D：只落 name+input+summary、封装名过滤、无 token）| 单测：conductor 跑通带工具；变异测试（改坏任一资源轴作用域 → 测试 fail）|
| **S4** | CTS/Oztop 真实数据端到端跑一次，对比 v1/v2 work order 质量 + 成本日志 | 人工验收 + 成本 ≤ 预算 |

**测试基线**：现有 conductor 测试全过（回归）+ **资源身份隔离变异三件套（条款 E）** + 截断保护测试 + tool trace 落库/封装名/无 token 测试。**每个隔离测试必须「改坏 handler 用 input.* → 测试 fail」验证非空架子。**

---

## 7. 安全审查清单（狄仁杰已审 · 结论内嵌）

1. **跨客户越权（4 轴）**：工具入参零资源标识符（闸1）+ ctx 闭包绑定 client_id/domain/siteUrl/propertyId 全 4 轴（闸2）+ 防御忽略入参标识符（闸3）。**变异三件套证明伪造 client_id/site_url/property_id/domain 全部无效**（条款 B/C/E/F）。
2. **被包装函数自身越权**：✅ 狄仁杰实读——`fetchOutcomeConfidenceMap` **查全表**，禁用，改 `fetchClientOutcomeHistory`（条款 A）。GSC/GA4/dataforseo 的越权维度是 siteUrl/propertyId/domain 而非 client_id（条款 B/C）。
3. **写路径旁路**：✅ 狄仁杰实读 4 库确认 GSC/GA4/dataforseo 全 `fetch` 只读、outcome 全 `.select`，**零 INSERT/UPDATE/DELETE**。实施时 grep handler 落实。
4. **prompt 注入**：v0.1 论断（「入参无 client_id → 注入无入口」）**被狄仁杰推翻**——注入不需 client_id，塞个公开 domain 即可。v0.2 修正论断：因**全部 4 个资源标识符均服务端注入、入参层不暴露**，注入无可填的口子。✅ 成立。
5. **工具结果回灌 + trace 落库泄漏**：条款 D——只落 name+input+summary、封装名过滤、无 token；落库前必先修好 A/B/C 数据源，防二次泄漏永久落错客户名下。
6. **成本 DoS**：✅ 狄仁杰确认 `maxToolRounds` 服务端硬编码上限（client.ts:410/467），Claude 无法绕过放大。
7. **上游 access 闸不等于工具隔离**：⚠️ conduct route 有 `requirePaidClientAccess(clientId)`——但那只保证**调用者有权访问该 clientId**，不保证**工具查询不越界到别 clientId**。两闸不同，本 spec 的 §3.3 是后者，不可用前者替代。

---

## 8. PM-Review 卡片

- **用户能感知什么**：诸葛亮定的战略优先级更基于一手数据（不再只看分数拍脑袋）；PM 可在后台看到「诸葛亮拍板前查了哪些数据」的 trace。
- **数据改动**：无新表。tool 调用轨迹落进现有 `flywheel_actions` 的 jsonb meta。
- **回滚损失**：回滚只丢「诸葛亮会调查」这个能力，退回单步拍板；无数据损失、无 schema 变更。
- **不可逆操作**：无 migration、无删除。纯代码改动，Render 自动部署。

---

## 9. 未决问题（PM / 狄仁杰定）

1. **成本上限拍板**：long 模式 `maxToolRounds=4` 是否接受最坏 ~$0.25/次？（**PM 业务决策 · 唯一待你拍的**）
2. ~~狄仁杰审~~ **已审已纳入**：升级为「资源身份强作用域」+ 条款 A–F。狄仁杰未要求加 RLS 兜底（应用层 4 轴注入 + 变异测试足够），符合 ME service-role 数据模型。
3. 工具 trace 落 jsonb meta vs 未来专门表——v1 先 jsonb，量大了再迁（技术，子牙拍，不上抛）。

---

## 附：与 CLAUDE.md 约束对照

- ✅ 全自动优先：诸葛亮更聪明地自动决策，PM 不多操作
- ✅ 数据全留存 ME 容器：tool trace 落 Supabase
- ✅ 无第三方 agent 托管：能力在 ME 自研 `callClaudeWithTools`
- ✅ 不凭空注入业务数据：工具查的是 master_brief/GSC/GA4/DataForSEO 真实源
- ✅ service-role 数据模型：工具走 supabaseAdmin，client_id 应用层作用域（非 end-user RLS）
- ✅ 大任务审查：子牙起草 + 魏征/板桥/**狄仁杰全部已审**（4 agent 签字）+ migration 无（不触发 PM migration 关卡）
- ✅ 多客户数据隔离红线：资源身份 4 轴全服务端注入 + 变异三件套（狄仁杰硬阻塞条款 A–F 已纳入）
- ✅ 外科手术改动：conductor 改动面最小，callClaudeWithTools 只加透传不改 end_turn 行为
