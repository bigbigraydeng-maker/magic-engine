# 广告巡检 · 广告级规则 D2（素材疲劳）+ D10（点进去之后差了）设计稿 v2

- 日期：2026-09-26 · 作者：卫青（Claude Code）· 风险级：**B**（只读规则、不碰钱、不接自动动作）
- PM 方向（2026-09-26 拍板）：「规则判，AI 讲」——判断由确定性规则出，一处出、两处用（巡检今日待办 + 以后客户报告）
- 本 PR = 阶段 1（巡检）。阶段 2（`src/lib/meta/ai/analysis.ts` 吃规则结论、AI 只讲，含板桥 + 封装名检查）另开 PR，P2 排队
- 层级门：**L1 广告支柱既有能力扩展**（巡察诊断引擎加两条码），不新增能力线，不登记候选
- v1 → v2：吸收子牙（5 BLOCKER）+ 魏征（6 BLOCKER，含生产回放）设计审，逐条对照见文末附录

## 0. 摸底事实（2026-09-26 生产库 + 代码核实）

| # | 事实 | 证据 |
|---|---|---|
| F1 | 巡检 D3 只判**广告组**层；loader 只读 campaign/adset 两层日数据 | `diagnostics/loader.ts:76-80` |
| F2 | CTS 目标单次成本已配置（11），主结果=留资 | `ad_strategy_configs` |
| F3 | v4 表单那条没被抓：所在广告组 7 天 $334.23/21=$15.92 < 2×11 → **被同组便宜兄弟稀释**；单条 $167.48/5=$33.5（魏征独立复算一致） | `ad_daily_insights` 9/18–24 |
| F4 | 广告层日数据 `parent_id` = **广告系列** id；广告→广告组只能用快照 `adset_id` | `daily-insights.ts:404`、`snapshot.ts:223` |
| F5 | 广告层 `frequency_7d` 全空；**系列层**最新一天有 7 天去重频次 | `daily-insights.ts:318-335`、`evaluate.ts:154-156` |
| F6 | CTS 账户只登记给 CTS、五层快照每天抓，**但里面有别的客户在投的广告**（创意主页 ≠ CTS 登记主页）→ 登记表没反映共用。`run.ts` 注释不能删，要改写成通用说法 | 快照 `creative_page_id` vs `clients.facebook_page_id` |
| F7 | D3 命中进 `ads-d3-auto-pause.ts`（只认 `code==='D3'`、只认广告组层）→ 新码进不去 | `:186`、`:316` |
| F8 | 疲劳口径现存 5 份（analysis.ts 代码/提示词、`baseline.ts` 系列层 30%/20%、`prescription.ts` 频次 2.5、手册 §21 频次 3） | 各文件 |
| F9 | 巡检结论目前不进 PM 今日待办 | `pm-todo/` 无读取者 |
| F10 | 广告层 `actions` 8 月中前整片空；近期每周 2–4 行空，全是曝光 1–3、点击 0 的微量天 | 生产统计 |
| F11 | 快照 `learning_stage` 生产全空 → 不能靠它判学习期；设置指纹 `settings_hash` 含 effective_status、预算、定向，变了记 `capture_reason='changed'` | `snapshot.ts:289-304,369`、魏征回放 |

## 1. 适用范围（先过闸，再判）

每条广告必须全部满足才进规则：
1. 所在账户非共用（`run.ts` 已拦）；所属广告组/系列不在 Meta 实验中
2. **广告快照 `creative_page_id` = 客户登记主页 `clients.facebook_page_id`**（F6；主页没登记 → 该客户广告级规则整段不跑，出一条客户级 `not_comparable / client_page_unknown`，有花费时才出）
3. 广告 `effective_status ∈ DELIVERING_STATUSES`
4. 优化目标是「冲点击/结果」类：`LEAD_GENERATION` / `QUALITY_LEAD` / `CONVERSATIONS` / `LINK_CLICKS` / `LANDING_PAGE_VIEWS` / `OFFSITE_CONVERSIONS`（播放、触达、主页互动类不判，魏征 C8）
5. 近 3 天花费 ≥ 所在广告组近 3 天花费的 10%，且 ≥ 基线每结果成本（没有基线成本时 ≥ 广告组近 3 天的 10% 单独成立）（魏征 C7：饿着的小广告不占 PM 待办）

## 2. 五条判断 → 规则

### 2.1 核心指标跟着「去向」走（判断 4）
`rules/core-metric.ts`：`resolveCoreMetric({ destinationType, optimizationGoal, clientPrimary })` → `OutcomeStep` `'messaging_started' | 'lead' | null`；计数复用 `countOutcome`（`outcome-ladder.ts`，同一次巡检里 D3 和 D10 用一套解析；它的动作优先级与 `objective-metrics.ts` 的 LEAD/MESSAGING_ACTION_PRIORITY 一致，都是取第一个、不相加）。
- 私信去向（`MESSENGER` / `WHATSAPP` / `INSTAGRAM_DIRECT` / `MESSAGING_*`）+ 优化目标 `CONVERSATIONS` → 开聊
- 私信去向 + `LEAD_GENERATION`/`QUALITY_LEAD`（两可，Messenger 里填表 §13）→ 客户配置的主结果若是 `lead` 或 `messaging_started` 就用它，否则开聊（魏征 C2；这是客户配置层，不是行业表）
- `ON_AD` / `LEAD_FORM_MESSENGER`，或 `LEAD_GENERATION`/`QUALITY_LEAD` + 其他去向 → 留资
- 其余 → null（不做 D10；D2 仍可跑，只看点击率）
- 标题里必须写明比的是哪种结果（子牙 C2：同组可能 D3 按留资、D10 按开聊）

### 2.2 自身基线 vs 同组对照（判断 1）
- 近期窗 = 评估日往前 3 天；基线窗 = 近期窗之前 14 天。
- **自身历史**（D2 只认这个；D10 优先）：基线剔除广告在数据里**首次投放后的头 7 天**（新广告蜜月期，魏征 B2），剔除后基线窗 ≥ 5 天有曝光。
- **最近改过 = 剔除，不是一票否决**（只挂在自身历史上）：本广告 / 所属广告组 / 所属系列最近一次**真改动**（见第 8 节），或所属广告组整日断投（同账户别的组在花钱）的日子记为 L（账户时区、不晚于评估日）。自身对照只用 L+7 天之后的日子；近期窗第一天早于 L+7（还在重新学习）且按改动前的对照本会命中 → `not_comparable / recently_changed`：「L 改过…先等到 L+7 之后再判」。数据来自 loader 已读的 35 天快照，不加查询。
- **同组对照**（只给 D10，且只在自身历史不可用时）：同一广告组（按快照 `adset_id`，F4）、同核心指标的其他广告，在「基线窗+近期窗」共 17 天的合计。**同期同组的结构改动对两边一样，所以不挂最近改过闸**（v4 所在组 9/16 从手动分预算改成系统分预算，挂闸会把核心案例挡掉）。标题写「比同组其他广告低」，不写「掉了」（子牙 B2）。证据带兄弟条数（子牙 C13 幸存者偏差）。
- **同组对照的前提**：这条广告在同一段时间（17 天）的花费 ≤ 同组其他广告合计。它自己就是组里的主力时，拿被饿着的小广告当对照会把主力判坏（实现后生产回放发现，见第 7 节）。
- 都不可用 → 不出结论。

### 2.3 样本够不够看上游（判断 3）
- 基线量门槛：D10 基线**结果 ≥ 20 且链接点击 ≥ 30**（魏征 C1：基线稳不稳看结果数）；D2 基线曝光 ≥ 3000、基线 CTR ≥ 0.5%（复用 `DEFAULT_BASELINE_CONFIG.ctrSignalFloor`）。
- 近期门槛：期望数（近期上游 × 基线率）≥ 5；近期曝光 ≥ 500（D2）。
- 检验：**单侧 Fisher 精确检验**（两边都是样本，子牙 C5），用 lgamma 算、按 k 递推（子牙 C6：曝光上万不能 O(n²)）；同一账户当天所有 D2/D10 候选的 p 值做 Benjamini–Hochberg（复用 `d5` 导出的 `benjaminiHochberg`），调整后 ≤ 0.05。
- 持续性：近 3 天里至少 2 天**单日**率也低于基线（魏征 C3：真实日波动约二项的 2 倍）。
- 降幅：D10 点击→结果相对降 ≥ 40%；D2 点击率相对降 ≥ 25%（= analysis.ts 现行 0.75）。
- 边界：结果数 ≥ 点击数的天/合计 → 该步视为没掉；基线率上限截到 1（魏征 C4）。
- `actions` 为空：点击 = 0 的天按结果 0 计；点击 > 0 且 `actions` 为空的天整天剔除（魏征 C5）；近期剔除后有花费的天 < 2 → 不判。
- 反方向（样本不够）：近期每结果成本 ≥ 2× 基线、但期望结果 < 5，且过了第 1 节第 5 条花费闸 → `not_comparable / below_min_sample`：「点击才 N 次，还不够判；再跑到约 M 次点击再看」。只进看板/内部日报，**不进 PM 待办**。

### 2.4 逐步漏斗（判断 2）
- **D10 · 点进去之后差了**：点击→核心结果按 2.3 显著下降，**且近期每结果成本 ≥ 1.5× 基线，且曝光→结果也相对降 ≥ 40%**（魏征 B1：点击率高一倍、转化低一截但每次曝光换来的结果差不多的广告不算坏）。证据带三步：点击率、点击→结果、每结果成本（近期 vs 基线）。
  - 点击口径：链接点击 `link_click`（更贴近打开表单/私信）。
- **D2 · 素材疲劳**：只用自身历史；曝光→点击（全点击 `clicks`，与 0.5% 地板同口径）按 2.3 显著下降。频次分型（§8）用**所属系列最新的 7 天去重频次**（F5，受众层属性；零新增接口调用）：
  - > 3 → 同一批人看腻了；≤ 3 → 素材老化；拿不到（系列近 2 天无值）→ 「频次拿不到，分不清是素材老了还是人看腻了」，不给分型处方
  - 门槛 3 = 手册 §21 = analysis.ts 提示词。`baseline.ts`/`prescription.ts`（2.5）是广告健康页那套，本 PR 不改，D2 原因里写明口径，统一记后续事项（子牙 C7：不叫「统一」）
- 同一条广告两步都掉 → 各出一条，证据互带对方那步数字。

### 2.5 每条建议带回头检查（判断 5）
`Diagnosis` 新增可选 `checkBack: { after: string; condition: string; fallback: string }`（不叫 stopLoss，免得跟执行模块 `ads-strategy/stop-loss.ts` 混，子牙 C8），同时追加一句「止损：…」进 `reasons`。**72 小时后没有程序回头检查**，这是给人的约定，不说成闭环。
- 检查时点 = 「7 天」与「上游攒够最小样本（期望结果 ≥ 5）预计天数」取**较晚**（魏征 B3：72h 落在学习期里、样本不够，判的是噪音）
- 一次只改一处；改动会重置学习期（§13）
- D10，新广告（数据里首投 ≤ 14 天）：到时点击→结果仍低于对照的一半 → 停这条新广告，老广告不动
- D10，老广告：先查表单问题数 / 落地页 / 私信开场有没有改过，**先别动预算**；到时仍低于基线一半 → 再决定
- D2 素材老化：**同一系列里另建一个新广告组**测新素材（共享预算），这条先别动——往正在跑的组里加广告也会让它重新学习（§27、§18）；到时新组素材点击率不到这条基线 75% → 停新建的测试组
- D2 频次拿不到：不给分型处方，只说「先看系列 7 天频次再决定」
- D2 看腻了：扩受众；到时点击率没回到基线 75% → 改回原受众
- 全部只读诊断口吻，不出挪预算处方（`types.ts:4` 约定，子牙 C9）

## 3. 输出：进 PM 今日待办（只读，不接任何动作）
- 新 `src/lib/pm-todo/ads-rule-finding-items.ts`：读近 14 天 `ads_growth_states`，每客户取最新一行；`payload.dataCompleteness === 'partial'` → 这客户今天不出（魏征 C6 / 子牙 C12）；取 `code ∈ {D2, D10}` 且 `status='hit'`
- 连续天数按「客户 + 码 + 广告 id」从近 14 天行里算，复用 `remind-cadence.ts` 的 `shouldRemindToday`（前 3 天每天、之后只周日），魏征 B6
- **每客户一条**汇总待办 `ads_rule_finding`（仓库惯例，子牙 C11）：what = 「N 条广告有问题：最要紧的是…」；how = 前 3 条各一句（广告名 + 结论 + 止损）；href = **完整网址** `https://app.magicengine.com.au/dashboard/clients/<id>/ads-health`（子牙 B4；Ads Manager 在登录墙后不给深链）
- 放「需要你动手」栏：这些要人拍板（改不改、怎么改），系统不会自动做
- `clientVisible=false`；单位 = 广告（`level:'ad'`）+ 所属广告组（带角色，子牙 C10）

## 4. 改动清单
| 文件 | 改什么 | 谁写 |
|---|---|---|
| `src/lib/ads-strategy/rules/core-metric.ts` 新 | 2.1 | DeepSeek |
| `src/lib/ads-strategy/rules/stats.ts` 新 | lgamma、单侧 Fisher（递推） | DeepSeek |
| `src/lib/ads-strategy/rules/funnel.ts` 新 | 纯数据形状（按天 `{impressions, clicks, linkClicks, results\|null, spend}`）的窗口合计、持续性、步骤判定；阶段 2 可直接喂 Graph 行 | DeepSeek |
| `src/lib/ads-strategy/rules/fatigue.ts` 新 | 频次分型 + 常量 | DeepSeek |
| `diagnostics/d2-d10-ad-rules.ts` 新 | 适用范围闸、DailyRow→规则形状、基线选择、最近改过闸、出 Diagnosis + checkBack | DeepSeek |
| `diagnostics/types.ts` | `'D10'`、单位 `'ad'`、`checkBack?`、`NotComparableReason` 加 `recently_changed`/`client_page_unknown`、`AccountInput.adDaily?`/`settingChanges?`/`DailyRow.frequency_7d?`、`DiagnosisInput.clientPageId?` | DeepSeek |
| `diagnostics/loader.ts` | 另查广告层（非共用账户才查；`.order('insight_date').order('entity_id')` + 按键去重，子牙 B5）；系列层多取 `frequency_7d`；从已读快照抽 `settingChanges`；读 `clients.facebook_page_id` | DeepSeek |
| `diagnostics/run.ts` | 调用；改写注释为通用说法（去客户名/账户号） | Claude（小改） |
| `pm-todo/ads-rule-finding-items.ts` 新 + `manual-item-types.ts` 类型 + `manual-items.ts` 一处接线 | 第 3 节 | DeepSeek 新文件；接线 Claude（千行文件例外） |
| 测试 | 第 5 节 | DeepSeek + Claude 核 fixture |

## 5. 验证
- 单测：去向映射（含两可组合走客户主结果）；Fisher 对照已知值；持续性闸；结果>点击边界；`actions` 空两种情况；兄弟按快照 adset_id（`parent_id` 故意给系列 id）；别人主页的广告不判；非在投、播放类不判；最近改过闸只挂自身历史；D2 不用兄弟基线；成本闸挡掉「转化低但便宜」；待办链接以 `https://` 开头；partial 日不出；连续天数提醒节奏。
- 回放 fixture（id 脱敏、比例取生产）：①v4（新广告，同组对照）→ D10 命中，D3 不命中；②高点击低转化但便宜的再营销广告 → 不命中；③新上线头 7 天点击率回落 → D2 不命中；④系列改过设置的广告 → recently_changed。
- 变异（B 级：关键闸手工变异）：p 闸、期望数闸、降幅闸、成本闸、持续性闸、主页闸、兄弟分组键、最近改过闸、去向优先级 → 每个变异都要有测试变红。
- 老测试全跑；`npm run type-check` 只看改动文件无新增（基线 18 个旧错，在别的文件）。
- 生产只读回放：本地用 CTS / NAL 当前数据跑 `runDiagnostics`（只读库，不发邮件、不写库），结果贴 PR。

## 6. 不做（本 PR）→ 后续事项
- analysis.ts / 客户侧报告（阶段 2，P2）
- 广告层 7 天去重频次（每账户多一次 `level=ad` 汇总调用）
- `baseline.ts`/`prescription.ts` 疲劳口径统一（接一键补素材的生产路径，单独评估）
- 共用账户里别的客户的广告污染 D1/D3/D5 的广告组层判断（F6 的另一面，本 PR 只保证新规则不串台）
- CPM 上涨判定、账户活动日志学习期识别、D6 行业先验；任何自动暂停/改预算/改素材
- 覆盖面：网站转化类留资（`OFFSITE_CONVERSIONS`/`WEBSITE`）D10 为 null 不覆盖，D2 覆盖

## 附录：审查意见落地对照
子牙 B1 频次→系列层 7 天去重（2.4）· B2 D2 只自身（2.2）· B3 学习期→快照 `learning_stage` 生产全空，改用设置指纹「最近改过闸」（2.2，与魏征 B2 合并）· B4 完整网址（3）· B5 分页二级排序+去重（4）· C1 countOutcome（2.1）· C2 标题写结果类型（2.1）· C3 纯数据形状（4）· C4 BH（2.3）· C5 Fisher · C6 lgamma · C7 不叫统一 · C8 checkBack · C9 不出挪预算 · C10 单位带广告组 · C11 每客户一条 + remind-cadence · C12 partial · C13 兄弟条数 · C14 覆盖面 · C15 注释去客户事实 · C16 共用账户不查广告层。
魏征 B1 成本闸（2.4）· B2 蜜月期剔除 + 最近改过闸（2.2）· B3 检查时点与处方改写（2.5）· B4 频次改系列层去重值，拿不到不分型（2.4）· B5 主页闸（1）· B6 remind-cadence（3）· C1 基线看结果数 · C2 两可用客户主结果 · C3 持续性 · C4 边界 · C5 actions 空 · C6 partial · C7 花费闸 · C8 按优化目标开关 · C9 兄弟口径 · C10 样本不够不进待办。

## 7. 实现后生产只读回放（2026-09-26）
数据：CTS、NAL 两客户 8/28–9/24 广告层日数据 + 设置快照 + 设置变更，经数据库只读查询导出到本地临时目录，本地跑 `runDiagnostics`（不碰生产密钥、不写库、不发邮件）。评估日 9/20–9/24：
- **v4 表单广告 9/23、9/24 两天 D10 命中**（9/24：点击→留资 3.9% vs 同组 16.0%，每个留资 NZD 33.5 vs 7.05，期望 20.5 个，校正后 p≈6e-5），与魏征独立复算一致；9/22 只有 1 天数据被持续性闸挡住。
- 第一版回放 9/21、9/22 误报了组里花费第一的再营销广告（只有同组对照可用、成本 1.9 倍）。补两道闸后消失：①曝光→结果降幅 ≥ 40%（2.4）；②同组对照要求本广告花费 ≤ 同组其他广告合计（2.2）。
- NAL 5 天零命中；D2 5 天零命中（新广告蜜月期剔除 + 最近改过闸）；其余只有进看板/内部日报的 not_comparable 备注（样本不够 / 最近改过），不进 PM 待办。

## 8. 实施后复审（子牙 + 魏征，2026-09-26）落地
- 魏征 B2（最重要）：快照里约一半 `changed` 是我们自己的同步假改动（加字段 / 两个写入程序序列化不一致），Meta 修改时间没动 → 「最近改过」把 75/75 个判定对象全挡了。改为 `loader.ts realSettingChanges`：前后都有 Meta 修改时间只认它变；缺时比关键字段（不比 targeting_summary）；并从「一票否决」改成「改动日 +7 天之前的数据不进自身对照」（2.2）。改动时刻限制在评估日当天为止。
- 魏征 B1：9/17 回放把组里花费第一的再营销广告误报。同组对照加「上线至今整体成本 ≥ 1.5 倍同组」闸（该广告 1.29 倍被挡，v4 4.75 倍照报）。🔴 魏征另建议的「只在两边同时花钱的日子比花费」**没采纳**：新广告抢钱那几天按定义就花得比老广告多，会把要抓的 v4 本身挡掉（实测挡掉）；保留 17 天整体比。
- 魏征 B3 + 子牙 B1：D2 处方改为「同系列另建新组测」；频次拿不到不给分型处方；`reasons[0]` 改成建议句（看板卡片只显示第一条），统计 p 值只留在证据里；待办每条写「怎么办：…」+ 止损。
- 魏征 C3：同一件事连着 2 次巡察命中才进待办，中间断一次就重新数。子牙 C7：「客户没登记主页」这类配置缺口单独进待办（不再是死数据）。子牙 C8：内部日报补两个「判不了」标签。
- 子牙 C4：新广告文案改为「新上线或刚重新开投」。C6：证据补对照期/近期点击率、`rate_kind`。魏征 C1：新广告同组对照时回头检查时点 3 天起（§18：新广告抢钱三天不会自己纠正）。
- 不改（记理由）：魏征 C4「私信广告缺开聊字段按判不了」——手册 §12：Meta 对 0 的动作直接不列，缺 = 0 是平台语义；魏征 C5「两可组合按广告组目标」——PM 本任务明确「按去向，不按行业」，客户主结果只用来消歧 Messenger 里填表这种两可组合。
- 最终回放（9/10–9/24，CTS + NAL，真改动过滤后）：D10 只命中 v4 表单广告 9/23、9/24；D2 0 次（真实数据里这 15 天没有过得了自身对照的疲劳）；其余只有进看板的「样本不够 / 刚改过」备注。
