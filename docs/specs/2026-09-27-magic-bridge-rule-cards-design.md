# Magic Bridge 包 C · 客户页「需要留意的广告」卡片 · 设计稿 v2（子牙 / 魏征 / 板桥设计审后）

- 日期：2026-09-27 · 作者：卫青规则窗口（Claude Code）· 来源：PM 9/26 经小秘书转「做C包」，重启 ROADMAP 里搁置的包 C
- 前序：包 A（#2043 扣费修复）、包 B（#2049 巡检结论进报告第三部分）已上线；设计稿 `docs/specs/2026-09-26-magic-bridge-rule-findings-design.md` C 节
- 层级门：Magic Bridge = Meta Connector（L3）上的客户界面；只换展示位置，内容来自广告支柱既有规则（`client-copy.ts`），不新增能力线、不新增判断
- 风险级：**B**（客户可见页面 + 发给浏览器的字段白名单；不碰数据库结构、鉴权、钱、AI 提示词）。客户可见 → 子牙 + 魏征 + 板桥审
- 按 §11：频率 低（只有 CTS 在用，授权账户 7 个系列全暂停，短期不会有卡片出现）/ IMPACT 中 / 收入 中 → P2；PM 已明确要做

## 0. 事实核对（2026-09-27，main `77b3f7e8`，生产只读）
| # | 事实 |
|---|---|
| F1 | 巡检结论已随每份报告存进 `evidence.rule_section`（`analysis.ts:291`，类型 `RuleSectionInput`：`source:'patrol'` 带 `dataDate / adsChecked / findings[]`，或 `source:'none'` 带 `reason`） |
| F2 | 页面拿到的 `evidence` 经 `chartEvidence()` 白名单（`analysis.ts:359`），目前只放 7 个图表字段，**`rule_section` 被挡在外面** |
| F3 | 报告第三部分「三、需要留意的广告」由程序写（`renderRuleSection`），AI 不碰；页面按标题切段显示（`ReportView.tsx splitReportSections`） |
| F4 | 生产 12 份报告全部早于包 B（最近 9/24），**没有一份带 `rule_section`**；新报告要等客户再点一次生成 |
| F5 | CTS 授权的是第二个广告账户（`act_2202…`），7 个系列全暂停 → 生成新报告会直接是「没有可分析数据」，走不到第三部分（魏征更正）→ **短期内卡片区不会出现** |
| F6 | 失败的报告只要证据已读到也会存 `evidence`（`analysis.ts:462`），页面失败态已经会显示图表；例外：授权中途变了时数据库清空证据、读证据本身失败时没有证据 |
| F8 | 读报告与生成报告返回浏览器都只走 `chartEvidence`（`analysis.ts:374/382`），没有别的出口（子牙核） |
| F7 | `findings` 每条字段：`kind / adName / headline / detail / action / spend / explainsCtr`；文案已过板桥审（包 B） |

## 1. 做什么（v2）
**原则：卡片需要的每个字都由服务器拼好，页面只显示字符串；正文替换在服务器做，找不准就不动。**（子牙 S3、魏征 B1/S2）

1. **生成时多存一个短标题**（`client-copy.ts`）：`ClientRuleFinding` 加 `cardHeadline`——同一句话去掉开头的广告名和末尾「（数据截至 X）」（板桥必改 1）。只影响新报告；读的时候缺这个字段就用原 `headline`（生产目前没有带结论的报告，F4）。
2. **读报告时由服务器组卡片**（新纯函数 `buildRuleCards(ruleSection, reportText, today)`，放 `src/lib/meta/ai/rule-cards.ts`，服务器端调用 `client-copy` 的现有函数，不把 `client-copy` 打进浏览器）：
   - 只在 `source === 'patrol'` 且有结论时产出；否则 `rule_cards: null`
   - 逐条校验：`kind` 只能是两个固定值、文字都是字符串、广告名截到 120 字、`dataDate` 必须是 YYYY-MM-DD；**任何一条不合格 → 整个返回 null**（不出卡片、正文不动，避免「卡片漏了、正文也被替换掉」——子牙 S1）
   - 形状（全是拼好的中文字符串，不含广告 id 字段、花费字段、巡检码）：
     `{ title, intro, promise, cards: [{ adLabel, headline, detail, action }], bodyReplaced }`
     - `title`：「我们正在跟进的广告（N 条）」（板桥建议 4）
     - `intro`：「这次检查了 {adsChecked} 条正在投放的广告，下面{这条 / 这 N 条}有变化，其余没发现明显变差。」（板桥 5、6）
     - `promise`：今天 ≤ 复查日 → 沿用包 B 承诺句；今天 > 复查日 → 「这是 {数据日} 的数据，我们原定 {复查日} 前后复查，最新进展可以直接问我们的团队。」（板桥必改 2、魏征 S3）
     - `cards`：**全部结论**，按花费倒序（排完丢掉花费）；第一张解释点击率的卡在 `detail` 前补点击率解释句（与正文同一规则，只一次）
   - **正文替换在服务器做**（魏征 B1）：用 `renderRuleSection(ruleSection)` 重新生成第三部分原文，在报告全文里**精确找到且只出现一次**才替换成「三、需要留意的广告\n这 {N} 条已经放在页面最上方，这里不再重复。」（板桥 8），`bodyReplaced = true`；找不到或出现多次 → 正文原样，`bodyReplaced = false`（卡片照出，最多内容重复一次，不会丢内容）。库里存的报告不改。
   - `listAnalyses` / `job` 返回的 `report_markdown` 用替换后的文字，`evidence.rule_cards` 放卡片；`chartEvidence` 其余 7 个字段不变。
3. **卡片区**（新组件 `RuleCards.tsx`，只收上面的字符串）：放在报告状态区最上面、图表之前；**中性浅灰底，不用红色、不用警告图标**（板桥必改 3）；每张卡：小灰字「广告：{adLabel}」（长名字自动换行）→ 加粗 `headline` → `detail` → `action`；超过 5 张时第 6 张起收进「另外还有 N 条花费较少的，点开查看」（原生展开，魏征 S1：卡片给全部、正文一律一句话，不再重复前 5 条）。完成态与失败态（有证据时）都显示。
4. **没有卡片时**（没检查 / 没发现 / 旧报告 / 数据不合格）：不显示卡片区，正文第三部分原样（它自己会说明为什么没有），页面其余不变（子牙补写）。
5. 不做：改页面标题/品牌名；D11（`clientVisible:false` 本来进不来）；包 B 已有的 `placeRuleSection` 在 AI 漏写/乱写标题时的两个问题（魏征 S4，另开任务卡）；新表、新接口、新 AI 调用。

## 2. 客户文案（板桥审定）
- 标题：「我们正在跟进的广告（N 条）」
- 开头：「这次检查了 {n} 条正在投放的广告，下面这 {N} 条有变化，其余没发现明显变差。」（1 条时「下面这条」）
- 承诺句：未过复查日沿用包 B；过了复查日用「这是 {数据日} 的数据，我们原定 {复查日} 前后复查，最新进展可以直接问我们的团队。」
- 卡片：「广告：{名字}」+ 不带名字和日期的短标题 + 说明 + 我们怎么处理
- 折叠：「另外还有 N 条花费较少的，点开查看」
- 正文第三部分：「这 N 条已经放在页面最上方，这里不再重复。」
- 禁词沿用 client-copy 头注；不写「卡片」这种界面词

## 3. 改动清单
| 文件 | 改什么 | 谁写 |
|---|---|---|
| `src/lib/ads-strategy/rules/client-copy.ts` | `ClientRuleFinding.cardHeadline`；导出第三部分标题常量、承诺句、点击率解释句给服务器端用 | DeepSeek |
| `src/lib/meta/ai/rule-cards.ts`（新） | `buildRuleCards`：校验、组字符串、服务器端正文替换 | DeepSeek |
| `src/lib/meta/ai/analysis.ts` | `listAnalyses` / `job` 调 `buildRuleCards`，返回替换后正文 + `evidence.rule_cards` | DeepSeek |
| `src/app/meta-ads-ai/[clientId]/RuleCards.tsx`（新）、`ReportView.tsx` | 卡片区 + 挂载 | DeepSeek |
| 测试 | 校验（坏 kind / 坏日期 / 非字符串 → null）、1 条与多条措辞、过期承诺、正文精确替换（一次替换 / 找不到不动 / 出现两次不动 / AI 用阿拉伯数字写后续标题时第四到第八部分完整保留）、超 5 条折叠、不含 id/花费/巡检码、点击率解释只一次、失败态、没卡片时页面不变；更新 `analysis.test.ts:671` 的字段比对 | DeepSeek |

## 4. 验证
- 定向测试 + 类型检查；少量变异（白名单丢 spend、最多 5 条、替换条件 total≤5）
- **当场试跑**：页面在生产要登录客户账号才能看，本机测不了真实页面（记忆：鉴权功能 worktree 测不了）。本机用 CTS 形状的测试证据渲染组件截图给板桥 / PM 看；上线后第一次真实出现卡片要等 CTS 有正在投放的广告并重新生成报告——写进台账卡，不在生产点「生成」（会扣额度）。

## 5. 实施记录（2026-09-27）
- 与 v2 的一处简化：卡片短标题不在生成时另存，而是读的时候从原句里去掉开头「「广告名」」和末尾「（数据截至 X）」——旧报告、新报告都能用，生成步骤零改动。
- 当场试跑（本机，不点生成、不扣额度）：用 9/25 CTS 巡检真实结论（第一个广告账户上那条 v4 表单广告的 D10）→ `toClientFinding` → `buildRuleCards` → 渲染 `ReportView`：卡片 1 张、正文第三部分换成一句、后面用阿拉伯数字写的「4.」段完整保留；把「今天」设成 10/5 时承诺句换成过期说法。
- 变异探针 14 个全部被测试抓住（其中「日期格式不查」一开始没抓住：非法日期先被 Date.parse 挡掉，补了一个能被 Date.parse 读懂但不是 YYYY-MM-DD 的扩展年份写法）。
