# CRM 客人页：三套状态合成一个「该做什么」（v0.4 · 已实现；PM 本地验收后 AI 意向暂停影响名单）

**状态**：v0.3 · 2026-10-10 · PM 回「实现」→ 已实现（本分支）→ 实施后子牙 + 魏征复审意见已并入（见 §五）→ PR 待机器合并（B 级）
**风险级别**：B（员工后台界面 + `src/lib/crm` 一个纯函数；不碰数据库结构、鉴权、钱、外发。子牙确认）
**提出人**：PM 2026-10-10（看 NAL 全部客人页后的三段原话，见记忆 `feedback-crm-one-concept-intent-not-many-statuses`）
**§11 资源优先级**：频率 **高**（销售每天打开这一页决定先打谁）/ IMPACT **高**（卡在 Act：三套口径打架 = 系统在「先联系谁」上给错信号）/ 收入 **高**（NAL 月目标 300 开聊，先打错人直接少成交）→ 高高高 → **P0**
**不做**：订单系统对接、新表、新字段、改分段引擎的判据、改 AI 摘要的提示词、改今日待办邮件

---

## 一、给 PM 看的一页纸

### 现在的问题（NAL 真实数据，2026-10-10 查库，魏征复核过）

同一个客人身上同时贴着三张标签，三张说的不是一回事：

| 标签 | 在哪显示 | 说的是 | NAL 现状 |
|---|---|---|---|
| 「跟进到哪步」 | 列表一列 + 侧栏一个按钮 | 人工标的流程阶段（新线索 / 已联系 / 已报价 / 已成交…） | 229 人里 **199 人是空的**，只标了 30 人 |
| 「现在冷热」 | 列表一列 + 分段视图的 4 段标题 | 系统按「谁最后说话、等了多久」算出来的 9 种分段 | 每人都有，但名字像「聊过了，没下文」「交给系统跟」 |
| 「高 / 中 / 低意向」 | 侧栏顶部 AI 摘要卡（本周刚加） | AI 读完对话判的购买意向 | 218 段对话有摘要（私信 187 + WhatsApp 31；邮件没有）：高 43 / 中 87 / 低 62 / 不确定 26 |

销售打开页面要自己在脑子里把三张标签合成一个答案：「我现在到底该不该打他」。这正是 PM 说的「太复杂，没有直接引导」。

### 改成什么样

**只留一个概念：「该做什么」。** 两级显示：

**第一级（列表）—— 只分两堆：**

```
🔥 今天要联系（约 65 人）                    ← hot list，按紧急程度排好
   张三   回他 —— 客户来消息了，等了 18 小时                 💬
   李四   打给他 —— 刚留资料，还没人联系                     📞
   王五   打给他 —— 聊过一轮断了，AI 读完对话判他意向高        📞
   …

💤 先放着（约 165 人）                       ← cold list，默认收起
   赵六   系统盯着 —— 打了 3 次没接上，他开口会自动跳上来
   孙七   先别打 —— 他说明年才走
   周八   不联系 —— 已成交
   …
```

每个人只有一行：**动作动词**（回他 / 打给他 / 系统盯着 / 先别打 / 不联系）+ 破折号 + **为什么**。不再有「跟进到哪步」「现在冷热」两列，不再有 4 段标题。

两堆怎么分：**今天这页「客人在等你」+「还没搭上话」两层原样进 hot，「先放着」+「不在名单」原样进 cold**——没有人会因为这次改动从今天的名单上掉下去。唯一的新动作是**往上提**：聊过一轮断了、但 AI 读完对话判他意向高的人（NAL 现在 19 个），从 cold 提到 hot。意向中 / 低 / 不确定 / 没摘要的人**位置不变**。

**第二级（点开一个人的侧栏）—— 顶部一块，三行：**

```
┌──────────────────────────────────────────────┐
│ 打给他                                       │  ← 跟列表同一句，字大
│ AI 建议：打电话给 Tim，确认他是否需要装箱单    │  ← AI 摘要里现成的「下一步」
│ 到哪一步了：已报价 ▾                          │  ← 具体状态，点开可改（原来的改阶段面板原样挂这里）
└──────────────────────────────────────────────┘
```

「到哪一步了」就是 PM 说的「等报价 / 已入库」那一级。谁判的（人工 / AI 读对话 / 将来的订单系统）**只在真有记录时**在后面补一小截「· AI 从对话里读的」，没记录就不写——NAL 现在 30 个阶段全部没有来源记录，所以上线那天 NAL 看不到这一截，这是对的，不能瞎标「人工标的」（魏征）。订单系统接通后只是多一种来源，这一行不用重画。

### 页面会多几个字、少几个字

| 位置 | 少了 | 多了 |
|---|---|---|
| 全部客人 · 表头 | 「跟进到哪步」「现在冷热」两列 | 「该做什么」一列 |
| 全部客人 · 分段视图 | 「客人在等你」「还没搭上话」「先放着，系统盯着」「不在今天名单」4 个段标题 | 「今天要联系」「先放着」2 个 |
| 侧栏顶部 | 「高意向」小圆标、「AI 摘要」四个小字、单独的「现在：已报价」按钮 | 一块三行卡（上面画的那个） |
| 侧栏其他 | 不变（联系方式 / 要记住的事 / 两个动作按钮 / 时间线） | 不变 |
| 「决定」页 | 段名「客人在等你 / 还没搭上话」小字 | 改成「今天要联系」（它本来就只列这两层的人） |
| 今日待办邮件 | 不变（那里的客人条目本来就只写「该做什么」，没有状态标签） | 不变 |

### 「高 / 中 / 低意向」去哪了

不单独显示了，**并进排序和措辞**：意向高的人在「今天要联系」里排得更前；聊断了但意向高的人被提上来，一行里的理由带一句「AI 读完对话判他意向高」。PM 原话：既然已经分了高低意向，它就该是统一概念的一部分，不要再有别的身份状态。

### 审查顺带查出的一个真问题（跟这稿无关，但 NAL 销售现在就看得见）

NAL 的 187 张私信 AI 摘要里，**109 张正文写着「CTS 提供了…」**——CTS 是另一家旅游客户，这些摘要是 9 月 13 日身份修复之前生成的旧卡，一直没重算。它们现在就在侧栏里显示着。要另开一张卡重算 NAL 的旧摘要，不等这稿。

---

## 二、给工程看的部分

### 2.1 一个纯函数，三个页面共用

新建 `src/lib/crm/next-action.ts`（platform-shared，纯函数，无 IO）：

```ts
export type NextActionList = 'hot' | 'cold'
export type NextActionVerb = 'reply' | 'call' | 'system_watching' | 'hold' | 'do_not_contact'

export interface NextAction {
  list: NextActionList
  verb: NextActionVerb
  /** 列表那一行的人话：「回他 —— 客户来消息了，等了 18 小时」 */
  line: string
  /** 排序用，小的在前。 */
  rank: number
  /** 侧栏第二行；来自 conversation_briefs.next_action，没有就 null。 */
  aiSuggestion: string | null
}

export type StageSource = 'human' | 'ai_conversation' | 'order_system'

export function nextActionFor(input: {
  seg: SegmentResult                 // 既有：segmentContact() 的结果
  intent: IntentLevel | null         // 既有：conversation_briefs.intent_level（最新一张）；null = 没有摘要
  aiNextAction: string | null        // 既有：conversation_briefs.next_action
}): NextAction
```

**合并规则（全部复用既有判据，不新造；子牙确认覆盖全部 9 个 Segment）**：

| 既有分段 `seg.segment` | 既有层 | → list | → verb |
|---|---|---|---|
| replied / callback_due / clicked_link | waiting | hot | reply / call（按 `suggestedChannel`） |
| new_untouched / retry_channel | acted | hot | call |
| stale_conversation | queued | **intent === 'high' → hot；其余（medium / low / unknown / null）→ cold，与今天一致** | call / system_watching |
| handoff_sop | queued | cold | system_watching |
| nurture_future | off_list | cold | hold |
| excluded | off_list | cold | do_not_contact |

- **只认 `seg.segment`，不再另看 `stage.suppressed` / `isTerminal`**：`segments.ts:681-684` 已经把被阶段压掉的人判成 `excluded`，`pipeline.ts` 的 `stageSuppressesWorklist` 已含终结档（子牙必改 1）。
- **意向只能往上提，不能往下压**：这是 2026-08-02「33 人凭空消失」事故的硬约束。`intent === null`（邮件对话没有摘要；`brief-cycle.ts:256` 只跑私信，WhatsApp 另有一条线）= 维持现状，措辞里不得出现「意向低」。
- **hot 内排序 `rank`**：先 `compareForWorklist`（既有：优先级 + 等待时长），同一分段内 intent high 提前。不改 `SEGMENT_META.priority`。
- **`line`**：动词 + 「 —— 」+ `seg.reason`（既有那句）；stale + high 提上来的人追加「，AI 读完对话判他意向高」。`aiNextAction` 只在侧栏第二行，列表不展示。

**NAL 改后真实人数（2026-10-10 按 `conversations.last_message_from` 近似）**：客人最后说话 42 + 没搭上话的新人（少量）+ stale 里 high 19 ≈ **65 进 hot**；其余 ≈ **165 进 cold**。不会变成一座山（魏征必改 5）。

### 2.2 四段 → 两段，三处要一起改

`src/lib/crm/list-sections.ts` 的 `SECTION_OF_SEGMENT` 保留，上面加一层 `listOf(seg, intent): 'hot' | 'cold'`。以下三处写死了四段名，**必须同一个 PR 改完**（子牙建议 6 / 魏征必改 4）：
- `src/lib/crm/drawer-nav.ts:23` 自己声明的 `SectionKey` 字面量（上一位 / 下一位导航）
- `src/app/api/clients/[id]/crm/contacts/route.ts:117-144` 的 `SECTION_KEYS`（校验 `?open=` 和 `p_<key>` 参数）
- `src/app/dashboard/clients/[id]/crm/all/page.tsx:27,41` 从 drawer-nav 引的类型

段头文案：
```ts
hot:  { title: '今天要联系', hint: '按紧急程度排好了，从上往下打。' }
cold: { title: '先放着',     hint: '系统盯着，他一开口会自己跳上去。以后才走 / 已成交 / 别再联系的人也在这里。' }
```

`list-sections.test.ts:38,164` 断言四段顺序的测试要改。

### 2.3 接口

`/api/clients/[id]/crm/contacts`（列表）加：每人最新一张 `conversation_briefs` 的 `intent_level` + `next_action`。取法跟 `timeline/route.ts:206-210` 同：`conversations.contact_id` 做映射，一会话一张（`UNIQUE(conversation_id)`），多会话按 `generated_at` 取最新（魏征查过：同一人多段对话意向不一致只有 1 人）。响应直接回算好的 `nextAction`，页面不自己拼。

**「来源」不进列表接口**（子牙必改 3）：`contacts` 表没有 changed_by，要查 `contact_stage_events`，而列表是全客户整批拉，CTS 971+ 条每次都拉不划算。只在侧栏 `timeline/route.ts:155`（它已经在取阶段事件）算 `stageSource`：`STAGE_INFER_ACTOR` → `ai_conversation`，邮箱 → `human`，**没有事件 → null，不显示**。`order_system` 本轮只是类型里的一个预留值，没有任何代码产生它，也不写 UI 分支（魏征建议 7）。

`contact-response-row.ts:84` 的行形状被今天接口共用，改形状要补回归测试（子牙）。

### 2.4 侧栏

`ContactTimeline.tsx` 的 `BriefCard` 删掉，`PersonDrawer.tsx` 的「现在：xxx」按钮删掉，合成一个 `NextActionCard`（三行）。改阶段的选项面板原样挂到第三行的 ▾ 下——**NAL「已成交先录金额」那条分支（`PersonDrawer.tsx:347`）和 `PersonDrawer.test.tsx` 的 markingWon 测试要随面板一起搬**（魏征建议 6）。`drawerActions()` 不动。

### 2.5 「今天」接口与「决定」页

`/api/clients/[id]/crm/today` 现在只剩「决定」页（`decision-list.ts`）在用，它内部的三层分桶不动；`decisions/page.tsx:154` 显示的 `layerLabel` 换成 hot/cold 两堆的标题（它本来就过滤掉了 queued 层，所以只会显示「今天要联系」）。这样两个页面不会一个说四段、一个说两段（子牙必改 4）。

### 2.6 测试（魏征建议 8）

- 穷举：每个 `Segment` × 每个 `IntentLevel` **含 null** 都落进 hot 或 cold，且 hot + cold 总数 = 输入总数
- stale + unknown / null **不在 cold 以外**也**不在 hot**——即与今天一致
- 没有阶段事件时侧栏不出现「人工标的」字样
- drawer-nav 两段模式的上一位 / 下一位
- `contact-response-row` 形状回归

### 2.7 不做、留口子

- **不加列不加表**。订单系统接通那天，写阶段的 actor 取名 `order-system`，`describeStageActor` 加一行映射即可。
- **不改 `segmentContact` / `SEGMENT_META` / `stage-infer` 提示词 / 摘要提示词**。
- **不动今日待办邮件**。

### 2.8 既有问题（本轮不修，登记后续事项）

1. `segmentContact` 默认剧本是 `TOURISM_PLAYBOOK`，NAL 调用方（`contacts/route.ts:577`）没传剧本：`resolveWaitSignal` 对 NAL 无害（没有 `travelWindow`），**但 60 天的点击热窗口（`clickWindowMs`）也被 NAL 吃到了**（子牙建议 7）。
2. `stage-from-conversation.ts:278` 的提示词写死「CTS Tours New Zealand」在共享目录里——平台化红线 2 的既有违规，NAL 没跑这条推断所以暂未伤到。
3. `PersonDrawer.tsx:68` 写死 `NAL_CLIENT_ID`——既有，早有记录要改读配置。
4. stale + high 的人提上来后不会自己降温（摘要按会话覆盖写，`generated_at` 可能很久以前）——目前 NAL 没有超过 30 天的摘要，先观察；要降温再加时效（子牙建议 5）。
5. **NAL 109 张私信摘要正文冒充 CTS**（2026-09-13 修复前生成的旧卡没重算）——不属于本稿，但现在就在侧栏里显示，另开卡重算。

---

## 三、Reuse Statement（设计阶段版，实现后对账）

- **复用**：`segmentContact` / `SEGMENT_ACTION_META` / `compareForWorklist` / `list-sections` / `drawerActions` / `describeStageActor` / `conversation_briefs` 现成的 `intent_level` + `next_action` / `contact_stage_events`。
- **新增 platform-shared**：`next-action.ts` 一个纯函数 + 两段文案 + `NextActionCard` 组件。里面没有任何客户名、客户 ID、行业词（子牙确认）。
- **industry-specific / client-specific**：无新增。
- **换客户测试**：CTS（旅游）/ NAL（物流）/ 假想悉尼地产客户——合并规则只看「谁最后说话、等了多久、AI 意向」，三者都成立，不需改。
- **换行业测试**：同上；行业差异仍留在 `IndustryPlaybook`（既有）里。
- **tier-gate 判定**：L1 既有能力（CRM「Act：先联系谁」）的内部收口，不新增能力线、不新增支柱。

---

## 四、两审意见与处置（2026-10-10）

| # | 谁 | 意见 | 处置 |
|---|---|---|---|
| 1 | 子牙 必改 | `stage.suppressed/isTerminal` 是第二份判据，`segments.ts` 已判成 excluded | **采纳**：合并表只认 `seg.segment`（§2.1） |
| 2 | 子牙 必改 | 摘要只覆盖私信，邮件对话永远 intent=null；措辞不能写「意向低」 | **采纳**：null = 维持现状；稿里数字改成「私信 187 + WhatsApp 31」 |
| 3 | 子牙 必改 | 「来源」别进列表接口（要整批查阶段事件） | **采纳**：只在侧栏算（§2.3） |
| 4 | 子牙 必改 | 今天接口仍三层，跟全部客人页口径会再打架 | **采纳**：今天接口只剩「决定」页用，改它的段名显示（§2.5） |
| 5 | 魏征 必改 | stale 里 low/unknown 塞进 cold 是 08-02 翻版；unknown 样本全是等报价的人 | **部分采纳**：改成「意向只往上提，不往下压」——low/unknown/null 的人**位置跟今天一样**（今天 stale 本来就在折叠的「先放着」层），不是被新藏起来；unknown 不按 low 处理。魏征要「unknown 至少归 hot」没采纳：那会让 hot 多 22+ 人，且等于把「不确定」当「高」，跟 08-02 的教训是同一枚硬币的另一面 |
| 6 | 魏征 必改 | NAL 阶段事件 0 条，`?? 'human'` 会把来源不明显示成「人工标的」 | **采纳**：没事件不显示来源 |
| 7 | 魏征 必改 | NAL 109 张摘要写着「CTS 提供了…」，「AI 看他意向高」一点开就不信 | **分流**：污染是既有生产问题，另开卡重算（§2.8-5，优先于本稿上线）；本稿措辞保留「AI 读完对话判他意向高」，因为摘要卡今天本来就在显示 |
| 8 | 子牙/魏征 | drawer-nav / SECTION_KEYS / all/page 三处写死四段 | **采纳**：§2.2 |
| 9 | 魏征 必改 | hot 会变成一座山，要给真实人数 | **采纳**：按新规则 ≈ 65 / 165（§2.1） |
| 10 | 魏征 建议 | markingWon 流程随面板搬 + 测试 | **采纳**：§2.4 |
| 11 | 魏征 建议 | `order_system` / rank 别写 UI 分支 | **采纳**：只留类型 |
| 12 | 子牙 建议 | stale+high 永不降温 | **登记后续**：§2.8-4 |
| 13 | 子牙 建议 | `clickWindowMs` 60 天也被 NAL 吃到 | **登记后续**：§2.8-1 |
| 14 | 魏征 建议 | 补 5 条回归测试 | **采纳**：§2.6 |

---

## 五、实施后两审意见与处置（2026-10-10，提交 d8545481b）

当场试跑（NAL 生产只读，`scripts/probe-crm-priority-view.ts`）：229 人 → **hot 47 / cold 182**，stale + 高意向抬升 19 人，两张名单之和 = 总人数，摘要 216 张（私信 + WhatsApp 都接进来了）。§2.1 估的 65 / 165 用的是「对话表里谁最后说话」近似，分段引擎看的是触点；差额 21 人中 18 人是只有客人进线消息、从没有人回过的私信 / 邮件，引擎按既有规则在 3 天后交给系统（`handoff_sop`，今天的页面上他们也在「先放着」层），2 人被推迟，1 人在 hot。**这不是本次改动造成的，但说明 NAL 有 18 条进线从没被真人回过**，另开卡（§2.8-6）。

| # | 谁 | 意见 | 处置 |
|---|---|---|---|
| 1 | 子牙 必改 | `brief-lookup` 吞错无日志，真故障会变成「整页正常、全员无抬升」没人发现 | **采纳**：catch 里 `console.error`；响应不加字段（少一个字） |
| 2 | 魏征 必改 / 子牙 建议 | 接口测试「高意向抬升」拿的是没触点的 Bob，任何意向都在 hot，是假绿 | **采纳**：加 stale 罐头人 Stan（打过、回过、断了），high 在 hot、low 在 cold、没摘要在 cold 各断一次 |
| 3 | 魏征 必改 | 47 vs 估 65，15+ 个「客人最后说话」的人进了 cold | **查清**：见上段，既有分段规则，另开卡 |
| 4 | 魏征 必改 | 「NAL 109 张摘要冒充 CTS」没见台账卡 | **位置**：已派独立窗口（任务卡「重算 NAL 109 张冒充 CTS 的私信 AI 摘要」，PM 已点开），卡由那个窗口写 |
| 5 | 子牙 / 魏征 建议 | 两处 `line.slice(verbLabel.length + 4)` 绑死分隔符 | **采纳**：`NextAction` 多回 `reason` 字段，页面和侧栏直接用 |
| 6 | 魏征 建议 | 「还没判出来」对 NAL 199 个空阶段不准（没人标，不是没判出来） | **采纳**：改回「还没标」 |
| 7 | 魏征 建议 | `brief-lookup` 没单测 | **采纳**：`__tests__/brief-lookup.test.ts`（多会话取最新 / 非法值 / 没挂人） |
| 8 | 魏征 建议 | 时间线接口仍查 `conversation_briefs` 回 `brief`，前端不画了，每开一次抽屉一条死查询 | **采纳**：删掉，测试改成断言不再查那张表 |
| 9 | 子牙 建议 | `order_system` 分支今天无生产者 | **保留类型与一行映射**，无 UI 分支（与 §四-11 一致） |
| 10 | 子牙 建议 | 删阶段重指派只改 `contacts.stage` 不写事件，来源可能标成上一次事件 | **登记后续**（§2.8-7） |
| 11 | 魏征 建议 | `PersonDrawer.test` 一条 Uncaught `data.timeline.length`，HEAD~1 同行已有 | 既有，归因未确认，不在本 PR |

### 2.8 追加

6. **NAL 18 条进线（私信 13 / 邮件 5）从没被真人回过**，引擎 3 天后按既有规则交给系统——跟本稿无关，但销售看到「先放着」里有客人在等，会不信这页。要查这 18 条是 Meta AI 客服接了还是真没人回。
7. 删阶段时的重指派不写 `contact_stage_events`（`pipeline-stages/[stageKey]/route.ts`），侧栏来源可能显示上一次事件的来源；低频。

---

## 六、PM 本地验收后的改动（2026-10-10，PR #2421 追加）

PM 在本地页看完后提了几条，统筹窗口另转来两条，全部在同一个 PR 里处理。**本节优先于前文**——前文凡是说「意向高 → 提到今天要联系」「意向高排前面」的地方，以这里为准。

| # | 意见 | 处置 |
|---|---|---|
| 1 | AI「意向高」抽看了几个都不准 | **意向不再影响分堆和排序**，名单那一行不再写「AI 读完对话判他意向高」；侧栏只留一行灰色小字「AI 初判（未校准）」。原因：产出意向的提示词里没有任何书面判准，也从没校准过。校准方案见 `docs/specs/2026-10-10-crm-intent-calibration-plan.md`（只写不跑）。NAL 实测因此回到 hot 28 / cold 201（抬升 0）。 |
| 2 | 「今天要联系」里的顺序看不懂（最近联系一列 64 天前 → 11 天前 → 昨天来回跳） | hot 里只留一条规则：约好今天回电的最前，其余**最近有动静的排前面**。cold 沿用引擎原排序。 |
| 3 | 侧栏按钮太多（说了两遍） | 一屏只留一个主按钮（记一笔）；「没打通 / 发出去了等他回」「改到哪一步了」「要记住的事」收进「更多」；「到哪一步了」在卡里只读显示。 |
| 4 | Facebook / WhatsApp 不让回时还摆一整块输入框 | 窗口关了只留一句话 + 打电话 / 发邮件两个入口（没有的那条不给）。 |
| 5 | 默认平铺页应该像传统 CRM 显示阶段；「该做什么」只在点进去的智能视图里 | 平铺最后一列「到哪一步了」；分段视图按钮改名「✨ Magic Engine 智能」，「该做什么」只在里面出现。 |
| 6 | 「最近联系」一会儿是「29天前」一会儿是「9/10」 | 一年以内一律「N天前」。 |
| 7 | 往来记录里夹着「客人最近一次来信」这类没内容的条目 | 那是导入 WhatsApp 时写的占位标记；有 WhatsApp 对话的人不再把它们混进时间线。 |

**没做、已登记**：NAL 的「到哪一步了」199 人空着，是因为 AI 判阶段只给旅游客户开了（提示词是旅游语义），物流要另写一版——见 §2.8-2。
