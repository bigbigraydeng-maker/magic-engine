# ME CRM 升级 v1 · 传统列表模式 + 成交事实自动回流

状态：方案稿（未写代码）· 待子牙（架构）+ 魏征（挑刺）+ 板桥（非技术视角：CTS 员工 / PM 看得懂用得顺）三审 · 风险 **B 级**（写客户数据、改 PM/员工每天用的页面；不动钱、不对外发）· 代码由 DeepSeek 分轮写，本 spec 末尾是分轮清单
Repository Fact Gate：`origin/main` = `ed0d19ba` · fetched 2026-09-25 NZST
Tier Classification（Inline）：CRM 是 ME 既有 L1 平台能力（`contacts` / `contact_touchpoints` / `contact_identities` / `contact_stage_events` / `client_pipeline_stages` + `/dashboard/clients/[id]/crm`）。本次升级界面与推断逻辑，不新增能力线、不进 platform-candidates；行业/客户差异继续走每客户阶段配置与 `CUSTOM_COLUMNS`。
§11 资源优先级：频率 **高**（CTS 员工每天用、每天有新邮件/私信/留资）/ IMPACT 闭环关键度 **高**（Check 段没有成交真相 = 广告自治冲不了目标）/ 收入关联度 **高**（直接是成交数与续费依据）→ **P0**

---

## 0. 一句话结论

**把 CRM 从"系统替你挑今天该联系谁的卡片"改回"一张员工自己会用的表"，再让机器把已经在 ME 里的成交证据（info@ 邮件、Messenger、表格备注）翻成阶段和成交记录。** 前者解决"员工不用 ME、只用 Google 表"，后者解决"系统只记到 5 单成交、目标进度永远未判"。

## 1. PM 拍板与被改口的旧决定（2026-09-25）

PM 原话：「还是要升级 CRM，不要卡片模式，回到传统 crm 列表模式。只出方案，具体代码开发交给 deepseek 完成。」

| 旧决定 | 状态 |
|---|---|
| 2026-07-28「CRM 工作台先不要开发 until 我同意」 | **解除** |
| 2026-07-28 v1 阶段模型 LOCKED（9 档 + 营销资格维度） | **沿用**，不改语义 |
| 2026-09-09「CTS CRM = GoHighLevel」 | **搁置**（PM 未明说作废；ME 自建列表模式先跑，GoHighLevel 接入不推进） |
| 2026-09-24「线索一律写老表、FB 默认格式、别过度开发」 | **沿用**：老表继续是 Zapier/Make 的落地点与员工备份，ME 列表**读它不改它** |

## 2. 现状（2026-09-25 实查，数字均来自生产库）

- 员工实际工作面是 Google 表「FB 即时表单 Infrontof2000」：FB 默认 16 列 + `lead_status` + `员工跟进记录` + Many Chat + E1–E4 已发/打开 + 客户回复/回复摘要 + 邮件进度 + inbox_url + v4 两问。**员工在表上工作，不在 ME 上工作。**
- ME 里 CTS 964 个联系人（7/28 起有阶段事件）：contacted 438 / new 327 / quoted 76 / no_response 66 / deferred 42 / traveling_soon 6 / not_interested 5 / **deposit_paid 3 / paid_full 2**。Best of China 一团已招满，系统却只看到 5 单——**成交没回流**。
- 触点已在 ME 里的信号：info@ 邮件 1252 条（`microsoft_mail`，每天同步，**179 条含定金/付款/全款字样**）· Messenger 1279 条（已对上人）· Mailchimp 1054 · 留资表单 742 · 表格电话跟进 **287 条，2026-07-24 一次性导入后再没进**。
- 现有"表格→成交"程序（`src/lib/conversions/cts-crm-sheet-sync*.ts`）只认表里那一列阶段，而该列 1599 行只填 1 行。
- `me_sale_outcomes` purchase = 0 → 销售目标 `ce537a96`（9 单到 11/30）进度"未判"。

## 3. 目标与验收

**一句话**：员工从此在 ME 里干活、不回老表；机器把已经在 ME 里的成交证据翻成阶段和成交单；PM 主动收到"新成交"短邮件，不用打开系统。

| # | 目标 | 验收（可观察） |
|---|---|---|
| T1 | 员工日常动作在 ME 里能全部做完 | 筛选/排序/搜索/分页/行内改阶段/记一笔/标重要（含到期日）/点行看时间线/批量改阶段/复制当前视图链接。**验收改成 3 周**：C1 上线后 3 周，CTS 员工"打开老表天数 / 打开 ME 天数"由 ≥1 降到 ≤0.3（老表日志抽样）；不到达 = C1 未完成。**C1 前板桥先跟 CTS 销售陪跑 30 分钟看她们真的在老表上干什么**，不是照方案抽象列打勾 |
| T2 | 179 封"含付款字样"的邮件**100% 有下落** | 每封在系统里可查到状态之一：`auto_written`(强证据自动写)/`suggested_to_sales`(弱证据进员工待办)/`excluded:same_industry`(同行域名剔除)/`excluded:no_amount`(无金额)/`excluded:reversed`(改期/退款词覆盖)/`excluded:not_customer_email`(发件人不是本人)。**没有一封在识别器里默默消失**；有专用的"识别器巡检"页把这 6 类计数摆出来 |
| T2a | 强证据自动写的质量 | 179 封回放集内：强证据命中 ≥50%（89 封以上）· 强证据误判率 <5%（自动写的里冤枉别人的占比）· 同行邮件误伤 = 0（Orbit/Asiascape/HoT 一封都不许自动写）；员工挑 20 封做金标准回归，识别器和金标准逐封对。不达标 C4 不给合并 |
| T3 | 表格备注不再断流 | `员工跟进记录` 列 7/24 之后的内容进 `contact_touchpoints`（channel=phone, source=sheet_followup），每日增量、幂等 |
| T4 | 目标进度能算 | 销售目标 `ce537a96` 的 `current_value` 出现非空数字；广告 WP3 的 Check 能读到 purchase |
| **T5**（重定 · 现实版） | **CTS 页面上不出现别客户的语义** | 打开 CTS 的列表页看不到别客户名/团名/词表；`stage-from-conversation.ts:278`（CTS 提示词）/ `qualified-buyer.ts:198`（写死 stage_key `'qualified'`）等硬编码由本次触及的模块下沉到客户配置，**其他文件本次不动**。**Oztop / NM Medspa 可用性明确 out of scope v1**（这两家打开列表页会踩残留 CTS 语义，不当验收项） |
| **T6**（板桥新增） | **PM 感知得到"9 单进度不再未判"** | 识别到一条强证据自动写 → **立即**给 PM 发一封短邮件（≤3 行：谁 / 哪句话 / 累计 X/9 单），不等每日汇总；不是重复日报，是速报 |

**不做（v1 明确排除）**：GoHighLevel 接入 · 邮件营销序列编排（7/28 Phase 3）· AI 个性化回信生成 · 热度雷达重做（保留现有 `segmentContact`，只在列表里当一列显示）· 新建 deal 表（`contact_deals` v1 不建，成交金额先放 `me_sale_outcomes` 现有列）· 改老表任何一格。

## 4. 列表模式设计（T1）

### 4.1 页面
现状：`crm/page.tsx`（1791 行三层桶卡片看板）+ `decisions/page.tsx` 是 PM 说的"卡片模式"；`all/page.tsx` 已经是 `<table>`（5 列 + 点行展开 `ContactDetail`，含时间线/记一笔/改阶段/DncBanner/MessengerReply/EmailReply）。

**做法**：**扩 `all/page.tsx` 为默认主视图**（`/dashboard/clients/[id]/crm` 直接落它）；卡片看板 `crm/page.tsx` 与 `decisions/page.tsx` 退役（路由 301 到主视图 + 预设筛选）；`_components/QuickNote.tsx` 已 import 未渲染，顺手删掉。「今天要联系」= 主视图上的预设筛选"今天该联系"（复用 `day-list.ts` 判据）；「决策列表」= 预设筛选"等我决定"。不保留双模式。

### 4.2 列（默认顺序，员工可拖动/隐藏，按客户保存）
**默认视图分两套**：
- **员工全表视图**（默认）：15 列，见下
- **PM 简版视图**（板桥）：4 列 = 姓名 · 阶段 · 最近一次联系 · 下一步；PM 打开链接直接落这个视图

员工全表视图 15 列：姓名 · 电话 · 邮箱 · **阶段**（行内下拉，选项来自 `client_pipeline_stages`）· 感兴趣的团/产品（`metadata.tour_interest`）· 来源（表单/私信/邮件/手工）· 进线时间 · **最近一次联系**（时间 + 渠道 + 一句摘要）· **下一步**（现有 next-step 判据的一句话）· 热度（现有 `segmentContact` 分桶）· **重要标记**（见下）· 跟进记录（最新一条，悬停看全部）· v4 两问（出行时间 / 预算）· 邮件进度（E1–E4 发/开，来自 Mailchimp 触点）· 客户回复（最近一条 inbound 摘要）。

**重要标记**（板桥硬伤 2 · 从"一个 bool"升级）：一列显示"⭐ + 一行原因 + 可选到期日"，替代老表 R/S 列的红字（"约好周三 3 点回电"/"only email"）。**到期日到了自动冒到今日待办**（新 kind `crm_important_due`）。写回既有 `contacts.pinned_at`（复用现有 pin 接口 L23）+ 新加两列（`important_note text`, `important_due_at timestamptz`，一次 migration）。

**默认排序**（魏征硬伤 6）：`pinned_at DESC NULLS LAST` → 用户选择的第二排序键。PM 不会再问"我置顶的跑哪去了"。

客户专属列走现有 `CUSTOM_COLUMNS` 注册表，不新建配置表（沿用 PR #678 契约）。**默认每页 100 行**（板桥），不是 50。

### 4.3 交互
- 服务端分页（100/页）、排序（任意列，默认 `pinned_at DESC NULLS LAST` + 用户选）、筛选：阶段多选 / 来源 / 热度 / **"我没跟进的"** / 日期范围 / **关键词搜姓名电话邮箱 + 跟进记录正文**（魏征硬伤 7）；URL 带参数、有**"复制当前视图链接"按钮**（板桥），刷新和同事之间传都不丢
- 行内改阶段 → 现有 `PATCH contacts/[cid]/stage`（新增 `machineGuards` 参数，见 §5.2）；行内"记一笔"（渠道 + 结果 + 备注）→ 现有 `POST touchpoints`；行内"标重要"（原因 + 可选到期日）→ 新接口 `PATCH contacts/[cid]/important`
- 点行展开时间线（现有 `timeline` 接口，所有渠道，邮件/私信原文来自 `conversation_messages`）
- 勾选多行 → 批量改阶段 / 批量推迟 / 批量清勿扰。**批量记一笔已有 `POST touchpoints/batch`（≤500 人，自动剔 DNC）**；缺的批量走**新增** `POST /crm/contacts/bulk`（action ∈ stage/snooze/dnc_clear/important，contactIds），照 batch 路由的 `.in + client_id` 收口，内部循环单人接口，**回执 shape 沿用 `{recorded, skipped, failed, notOwned}`**（子牙 Q2），不做 DB 事务（Supabase HTTP client 没跨请求事务，逐条已有 IDOR/幂等），"部分失败"就是最终态，回执告诉前端谁失败
- **新客人录入**（魏征硬伤 6）：列表左上角"+ 新客人"按钮 → 现有 `POST /crm/contacts`
- **BCC 群发**（魏征硬伤 6 · 方案原来说错了）：`touchpoints/batch` 是**记内部触点日志**，不是发邮件。BCC 群发要重新接线：把现有卡片页 `BatchEmail` 组件搬进列表页，走"复制邮箱到剪贴板 → 员工在 Gmail 发 → 回列表点"我发了"→ POST touchpoints/batch 记录"这个已有路径；本 v1 不做"从 ME 里直接发邮件"
- 改联系人资料（姓名/电话/邮箱）：新增 `PATCH /crm/contacts/[cid]` → `contact_identities` 唯一约束**一律拒绝返 409**（子牙 Q1），把冲突联系人 id 与提示"这个邮箱已属于另一个客人"给前端，员工点"打开那个人"或"换一个"——**绝不许自动合并**（合并不可逆，"打错一位数就撞到另一个真人是常态"，identity.ts:220-223 手工路径先例）
- 导出当前筛选为 CSV（员工偶尔要给老板看；只导出可见列）
- **不做**：自由拖拽看板、卡片、AI 推荐排序（热度只是一列，不决定顺序）

### 4.4 守卫
所有写接口沿用 `requirePaidClientAccess`（FDE/客户员工可写）+ 每条 `WHERE id AND client_id`（IDOR，7/28 三审硬伤 ②）。手工触点带前端 `clientRef` 幂等键（硬伤 ③）。批量操作按行回执，不整批回滚成"看起来没做"。

## 5. 成交事实自动回流（T2 / T3 / T4）

### 5.1 三条信号源（全部已在 ME 或已有读取路径）
| 源 | 现状（实查） | 做法 |
|---|---|---|
| info@ 邮件 | `contact_touchpoints` channel=email source=microsoft_mail，1252 条，每日同步（`src/lib/microsoft/mail-ingest.ts:622 syncMailbox`）；metadata 只有 subject/counterparty/automated/logged_by；**对正文零成交识别**（grep quote/deal/deposit/paid/invoice/成交/报价 零命中） | 新增**成交识别器**（纯函数）：只对 inbound、发件人是已知联系人或消费者域名（复用 7/29 的同行/供应商过滤思路：排除 `BUSINESS_EMAIL_DOMAINS` 与旅业同行）、正文命中「定金/deposit 已付/paid/全款/invoice paid/银行转账 + 金额」等 → 输出 `{stage: quoted\|deposit_paid\|paid_full, confidence, evidence: 引用句 + touchpoint_id}`；"改期/退款/取消"词盖过付款词（复用 `looksBackedOut` 思路） |
| Messenger | 1279 条已对上人（`src/lib/messenger/link-contacts.ts:598`）；另有 `src/lib/crm/stage-from-conversation.ts` 用 AI 推非成交阶段（`SAFE_STAGES` 不含 quoted/deposit_paid/paid_full） | 同一识别器跑 `conversation_messages` inbound；识别器与 AI 阶段推断解耦（AI 不改成交阶段） |
| 表格 `员工跟进记录` | `src/lib/crm/sheet-followup-sync.ts:280` 写 phone 触点 source=sheet_followup（7/24 只导入 287 条后再没进）；`CLIENT_FOLLOWUP_SHEETS:61` 只配了 CTS | 修复每日增量：读老表该列（只读），按 `l:<lead id>` 定位联系人（735 条里 347 条历史行没真编号，那批按邮箱匹配、匹配不上就跳过并计数），新内容 upsert phone 触点（source_ref=`sheet:<row>:<hash>` 幂等），过 `parseNote` 出 outcome；同一识别器对备注也跑一遍（员工常写"已交定金 $500"） |

### 5.2 写回规则（fail-closed）

**一句话**：宁少勿错，机器只在最有把握时动手；剩下的全给员工看一眼。

**判定顺序（缺一不可，任何一项失败就不是强证据）**：
1. **发件人是本人**（发件邮箱等于联系人身份邮箱）——不是本人，直接走"同行/身份不确定"路径，永不自动写（魏征硬伤 2）
2. **发件域名不在同行名单里**（Orbit/Asiascape/HoT 等旅业同行）——同行邮件即使谈定金也是代终端客户结算，**永不自动写 `me_sale_outcomes`**，只出"建议新建联系人 + 阶段"双确认待办
3. **命中付款动词 + 明确金额**（`$500 / NZ$500 / 500 纽币 / 5000 全款`）——**无金额一律弱证据**（"paid the full amount"/"invoice paid"没金额，不许自动写；魏征硬伤 3）
4. **无反转词**（改期/退款/取消/refund/cancel/postpone）

**写回**：
- **强证据**（四条全通过）→ 自动 `advanceContactStage`（只许**向前**：quoted→deposit_paid→paid_full）+ 写 `me_sale_outcomes`（source_kind 新加 `email_deal_parser` / `messenger_deal_parser` / `sheet_note_deal_parser`；`metadata.parser_version = 'v1'` + `rule_signature` 词表 hash，子牙 Q4） + `contact_stage_events`（changed_by=`system:deal-inference`，note 带引用句）+ **T6 速报邮件立即推给 PM**（板桥硬伤 1）
- **弱证据**（有付款词 / 无金额 / 或身份不确定 / 或同行代付）→ 不改阶段，进员工待办 `crm_stage_suggestion`（**默认发员工不发 PM**——板桥硬伤 3、§9 已定），what：谁/哪句话/建议改成什么；how：三个按钮——**"确认"（写回同强证据路径）/"这次不动"（24h 内同一人不再冒）/"永久忽略这封邮件"（触点 metadata 打 `deal_inference:{ignored_at, ignored_by, reason}`）**；魏征硬伤 5：忽略必选原因（同行 / 时机不对 / 需看老表）
- **弱证据日增熔断**（魏征）：任一客户 24h 新增 >20 条 `crm_stage_suggestion` → 停出建议 + 一条 PM 报警"识别器可能出问题了"
- **"179 封 100% 有下落"面板**（T2 板桥）：识别器巡检页把 6 种状态计数摆出来，没有一封在识别器里默默消失

**软锁**（子牙 Q3 + 魏征硬伤 4 合并）：
- `advanceContactStage` 新增 `machineGuards?: {humanLock?: boolean, forwardOnly?: boolean}` 参数；人工 PATCH 一律传 `undefined`（不受方向限制、可以向后退）；deal-inference 传 `{humanLock:true, forwardOnly:true}`
- `humanLock` 判据 = **最近 7 天有 phone/sheet_followup 触点** OR **最近 7 天有 changed_by 不以 `system:` 开头的 stage_event**——两个都算"最近有人碰过"，覆盖"员工不登录 ME 但每天在老表上工作"（魏征）与"员工在 ME 里改过阶段"（子牙）两种场景；靠现有 `contact_stage_events` + `contact_touchpoints` 查历史行，**不加 `contacts.stage_locked_until` 列**（子牙："加列是第二个真相源一定会漂"）

**其他**：
- `CONTACT_OUTCOMES` 新加 `quoted`/`deposit_paid`/`paid_full`
- 客户名、团名、金额门槛不进代码；付款词表为通用词表；同行域名与表格 ID 与备注列字母走**新加的 `clients.crm_config jsonb`**（**不塞 `brand_aliases`**——子牙 Q7：那列语义是品牌名，被 ai-tracker/geo-module 消费，塞表格 ID 会污染 AI 提示词）；金额币种从 `clients.country` 派生（`today/route.ts:327` 已有 NZ/AU 二选一）
- `CTS_BRAND_TERMS` 可以进 `brand_aliases`（是真品牌词）；`crm_list_prefs`（列顺序偏好）与 `crm_config`（服务端配置）**别一列两用**（子牙）

### 5.3 触发
`lead-sheet-sync`（已有 Inngest 函数）之后追加一步"备注增量 + 成交识别"；info@ / Messenger 同步函数结束后同样追加一步。**不新起独立 cron**；每步 receipt 落 `cron_run_logs` 或 Inngest step 输出。

### 5.4 与目标的接线
`autoFetchMetricValue('signups_count')` 现读 `me_sale_outcomes` purchase（已存在）→ T4 自动成立，不改目标代码。

## 6. 平台边界（T5）

- 列定义、阶段、筛选预设 = 每客户配置（`client_pipeline_stages` + `CUSTOM_COLUMNS` + 新增 `clients.crm_list_prefs jsonb` 仅存列顺序/隐藏，PM 明确"加字段必配 UI"——列顺序/隐藏由表头拖拽直接写，不另做设置页）
- 成交识别器：通用词表 + 客户配置的排除域名/币种；**禁止**出现 `ctstours` / `c0000000` / 团名
- 现有硬编码（`BUSINESS_EMAIL_DOMAINS`、`CTS_NOTE_COLUMN_SWITCH_ROW`）在本次触及的文件里下沉到客户配置；未触及的记入 ROADMAP，不顺手改

## 7. 分阶段交付（DeepSeek 分轮，每轮 ≤3 文件；接线点见附录 §11）

| WP | 内容 | 风险 | 复审 | 定量验收（不达标不给合并 · 魏征硬伤 6） |
|---|---|---|---|---|
| **C0 读模型** | 服务端分页/排序/筛选/搜索接口（扩 `GET /crm/contacts`）**+ 聚合下沉到 SQL group by**（子牙 Q5：CTS 964 已在 PostgREST 1000 行截断边界，`segment/temperature/hasMessenger` 今天可能算错，不能沿用 `fetchAll`） + 列定义扩展 + 路由测试 | B | 子牙 | 同一筛选与老表人数对得上（抽 3 个阶段）；聚合口径变异测试红一次 |
| **C1 列表页** | 扩 `all/page.tsx` 为主视图：列/行内改阶段/记一笔/抽屉时间线/批量/导出/URL 参数/列偏好/**重要标记升级（原因+到期日）**/**"我没跟进的"筛选**/**"复制视图链接"按钮**/**PM 简版视图 4 列**/新客人按钮/搬进 BatchEmail | B | 子牙 + **板桥（C1 前先跟 CTS 销售陪跑 30 分钟）** | **3 周**后 CTS 员工老表/ME 打开天数比 ≤0.3；不到达 = C1 未完成 |
| **C2 备注增量** | 老表 `员工跟进记录` 每日增量 → phone 触点（幂等、只读表）；`CLIENT_FOLLOWUP_SHEETS` 下沉到 `clients.crm_config` | B | 魏征（幂等/匹配错人） | 老表新增 3 条备注 → 次日触点 +3，重跑不重复 |
| **C3 成交识别器** | 纯函数 + 词表 + 反转词 + 置信度 + 同行域名判据 + 回放集 + **"179 封巡检页"** | B | 魏征 + 狄仁杰（同行/伪造邮件） | 179 封回放：**强证据命中 ≥50% · 强证据误判率 <5% · 同行邮件误伤 = 0**；每封在 6 种状态里 100% 落定 |
| **C4 写回 + 待办 + 速报** | 强证据自动写 + `machineGuards`（子牙 Q3 + 魏征 4）+ 弱证据 `crm_stage_suggestion` 待办（**默认给员工**，三按钮，同人 24h 合并）+ 确认接口 + 弱证据日增 >20 熔断 + **T6 强证据速报邮件立即推给 PM**（板桥 1）+ Inngest 步骤接线 + `me_sale_outcomes.metadata.parser_version` | **A**（写客户阶段与成交表；花钱 no，但改真相 yes） | 子牙 + 魏征 + 狄仁杰（授权/回滚） | 一封"已付定金 $500"邮件 → 阶段 deposit_paid + `me_sale_outcomes` +1 + T6 速报邮件到达 + `ce537a96` current_value 更新 + receipt 可查；一封同行邮件 → 不动，只出建议 |
| **C5 退役** | `crm/page.tsx`（1791 行）**直接删除文件不留 301**（魏征）；`decisions/page.tsx` 删；`crm/page.tsx` 的功能由 `all/page.tsx` 顶层组件承担（子牙 Q6：`[id]/crm/page.tsx` rewrite 渲染 all 组件，不做 client-side redirect）；**grep 所有邮件模板/Inngest digest 里有没有硬编 `/crm/today` 或 `/crm/decisions`**（子牙 Q6）；CHANGELOG | C | 板桥 | 旧路由访问 404 测试红一次；grep 结果 = 0 |

顺序：C0 → C1 与 C2/C3 并行 → C4 → C5。**C1 上线后先给 CTS 员工用 3 周**（不是 3 天），板桥收反馈再进 C4。

## 8. 安全底线
1. 机器只向前推阶段、不倒退、不删人、不合并人（7/29 魏征红线：正文抽联系方式建人 = 造假客户）
2. 弱证据不动数据，只出待办
3. 老表只读；写老表仍只走 #1975 那条"补漏"路径
4. 每个写端点 `WHERE client_id`；客户员工角色看不到别的客户
5. 所有推断带 receipt，可回放、可撤（撤 = 写一条反向 stage_event，不删历史）

## 9. PM 待拍板（只列业务）
1. GoHighLevel 那条是正式作废还是继续搁置？
2. 成交金额要不要在列表里显示（涉及员工可见工资敏感度？CTS 老板是否同意员工看见）
3. ~~弱证据的确认由谁点：PM 还是 CTS 员工（决定待办发给谁）~~ **已定：默认发 CTS 员工**（板桥硬伤 3；理由：员工每封邮件几秒钟就能判"真付了 $500"还是"客户在问什么时候付"，PM 会被 40-70 条/日淹没）；PM 每周只收一封"本周确认了 X 条 / 忽略 Y 条 / 命中率"摘要
4. 老表那条 Zapier/Make 写入要不要让 ME 接管（9/24 遗留问题，本次不动）

## 10. 三方复审必改项汇总（2026-09-25 板桥 + 魏征 + 子牙）

**板桥（真人视角，3 硬伤已全部合进方案）**：①T6 强证据速报邮件（§3、§5.2、C4）② 重要标记升级为置顶+原因+到期日（§4.2）③ 弱证据默认给员工不给 PM（§5.2、§9）；其他合并：3 周验收（T1）· 每页 100（§4.3）· PM 4 列简版（§4.2）· §10-13 附录化（本节）

**魏征（挑刺 6 硬伤已全部合进方案）**：①同行邮件永不自动写 me_sale_outcomes（§5.2 判定顺序 #2）②无金额一律弱证据（§5.2 判定顺序 #3）③软锁判据看"最近有触点"不看 changed_by 前缀（§5.2 软锁段落）④ BCC 群发不是 touchpoints/batch，改成剪贴板 + Gmail 手发（§4.3）⑤ T5 改成"CTS 页面不出现别客户影子"，Oztop/NM out of scope（§3 T5）⑥ 每 WP 定量验收（§7 表）；其他合并：新客人按钮 + `pinned_at DESC` 默认排序 + 关键词搜跟进正文 + "我没跟进的"筛选 + 忽略按钮三义 + 弱证据日增熔断 + 卡片页直接删文件不留 301

**子牙（架构 3 必改已全部合进方案）**：①软锁用 `machineGuards` 参数查 `contact_stage_events` + `contact_touchpoints` 历史行，不加列（§5.2）②C0 聚合下沉 SQL group by 而不是 `fetchAll` 内存组装（§7 C0）③`crm_config jsonb` 单独一列不塞 `brand_aliases`，`CTS_BRAND_TERMS` 可以进 `brand_aliases`（§5.2、§6）；其他合并：Q1 PATCH 一律拒绝返 409（§4.3）· Q2 bulk 回执 shape 沿用 `{recorded, skipped, failed, notOwned}`（§4.3）· Q4 me_sale_outcomes 加 `metadata.parser_version`（§5.2、C4）· Q6 卡片页用 rewrite 不 redirect + grep 邮件模板（§7 C5）

---

## 11. 附录 · 盘点接线点（路径:行号，2026-09-25 实查 origin/main ed0d19ba）

以下细节属实施参考，读一遍即可；DeepSeek 每一轮按 §7 表格 + 本附录里对应节动手。

### 11.1 页面（PM 说的"卡片模式" vs 已有的表）
| 文件 | 行数 | 类型 | 命运 |
|---|---|---|---|
| `src/app/dashboard/clients/[id]/crm/page.tsx` | 1791 | 三层桶卡片看板 + 内嵌 `ContactListView` L1238（跟 all 页重复）+ `OffList` L1286 卡片 | **退役**（301 到 `/all`） |
| `src/app/dashboard/clients/[id]/crm/decisions/page.tsx` | 173 | `buildDecisionList` 拍平成只读卡 | **退役**（预设筛选） |
| `src/app/dashboard/clients/[id]/crm/all/page.tsx` | 808 | `<table>` 5 列 + 点行展开 `ContactDetail` L302 + `?contact=` 直达 L579 | **扩为主视图** |
| `src/app/dashboard/clients/[id]/crm/unclaimed/page.tsx` | 192 | Messenger 认领 | 保留独立 |
| `_components/QuickNote.tsx` L240 | — | page.tsx L24 已 import 未渲染 | **删** |
| `_components/PersonDrawer.tsx` / `ComposeNote.tsx` / `ContactTimeline.tsx` / `DncBanner.tsx` / `MessengerReply.tsx` / `EmailReply.tsx` | — | 抽屉四件套 | **原样复用**，all 页展开区已经在用 |

### 11.2 读接口
- `GET /crm/contacts` `route.ts:83-268`：**零参数**、`fetchAll` 全量拉三张表内存组装 L100-128、返回 `{totalContacts, columns, contacts[]}` L263（含 segment/temperature、custom 列、DNC/坏号/hasMessenger）→ **加分页/排序/筛选/搜索参数**（C0）
- `GET /crm/today` `route.ts:115-865`：卡片看板取数（三层桶 + offList + suggestedStage）→ 退役，判据函数 `day-list.ts:dayWorklist` L471 保留给"今天该联系"预设筛选
- `GET /crm/contacts/[cid]/timeline` `route.ts:113`：抽屉时间线（≤2000/2000/3000 条）→ 原样复用
- `src/lib/crm/table-columns.ts`：`CustomColumnKey = 'tour_interest'` L20 唯一自定义列；`extractCustomColumns` L89、`visibleCustomColumns` L101 数据驱动显隐 → 复用

### 11.3 写接口（守卫全部 `requirePaidClientAccess`，无 `guardGlobalAdmin`）
| 路由 | 方法 | 行 | 写表 | IDOR |
|---|---|---|---|---|
| `contacts/[cid]/stage` | PATCH | L24 → `advance-contact-stage.ts:27` | `contact_stage_events` L70 + `contacts.stage` L85 | L36-41 `id=cid AND client_id` |
| `touchpoints` | POST | L46 → `touchpoints.ts:102 recordManualTouchpoint` | upsert `contact_touchpoints`(phone/me_manual) L134 + `contacts.last_seen_at` L177 | L107-119 |
| **`touchpoints/batch`** | POST | L36 (≤500 人 L28) | 逐人 `recordManualTouchpoint` L155，剔 DNC L129 | `.in('id', ids).eq('client_id')` L79-83 → **批量记一笔已完备** |
| `contacts/[cid]/dnc` | POST | L43 | 触点 `dnc_cleared` L91 → `contacts.do_not_contact=false` L118 | L73 |
| `contacts/[cid]/pin` | PATCH | L23 | `contacts.pinned_at` L59 | L44 |
| `contacts/[cid]/snooze` | PATCH | L29 | 触点 snooze L97 → `contacts.snooze_until` L127 | L49 |
| `contacts/[cid]/segment-feedback` | POST | L32 | `crm_segment_feedback` L70（不改人） | L54 |
| `contacts` | POST 新客 | L276 | `resolveContact` mergeStrategy=`reject` L315 | — |

**缺**：
- `POST /crm/contacts/bulk`（action ∈ stage/snooze/dnc_clear/pin，contactIds）——用现有单人接口内部循环
- `PATCH /crm/contacts/[cid]` 改姓名/电话/邮箱（`contact_identities` UNIQUE(client_id,kind,value) 冲突时的合并/拒绝规则由子牙定）
- 阶段推断反悔：撤销一条 `contact_stage_events` = 写反向 event，不删（安全底线 #5）

### 11.4 数据模型（migrations）
- `contacts` `20260726000004:29-50` + stage/stage_updated_at `20260728000001:69` + 归因列 `20260730145405:49` + snooze_until `20260803140000:23`；**`pinned_at` 代码在读写但仓库 migrations grep 不到 ADD COLUMN，需核生产库**
- `contact_identities` UNIQUE(client_id,kind,value) `20260726000004:82`
- `contact_touchpoints` UNIQUE(client_id,source,source_ref) `20260726000005:44`
- `client_pipeline_stages` marketing_action∈nurture/defer/suppress/postsale/won `20260728000001:41`
- `contact_stage_events(from_stage, to_stage, changed_by, note)` L76
- `conversations`(channel/contact_id/subject/status) `20260726000004:110`；`conversation_messages`(direction/sender_id/body/sent_at)
- `me_sale_outcomes` `20260905000002:57`：contact_id **可空**、outcome_kind∈purchase/balance/lead、review_status∈pending_review/approved/rejected、source_kind 已扩 crm_sheet_sync + crm_stage_manual → **本次再扩 `email_deal_parser`、`messenger_deal_parser`、`sheet_note_deal_parser`**
- **`contact_deals` 不存在**（src + supabase 零命中）——本次不建
- 阶段流转：`pipeline.ts` `MARKETING_ACTIONS` L12、`stageSuppressesWorklist` L31；`advance-contact-stage.ts:advanceContactStage(supabase, clientId, contactId, toStage, note, changedByEmail)` L27

### 11.5 信号入口
- `note-parser.ts`：`CONTACT_OUTCOMES` L24-44（8 类，**无成交/报价**）；`parseNote(raw, opts)` L532（规则 `classifyNote` L288 + OpenAI 兜底 L550）→ **加 quoted/deposit_paid/paid_full**（C3）
- `cts-crm-sheet-sync.ts:180 stageIsPurchase`：G 列以 4/5 开头 = 成交；`-run.ts` 只写 `me_sale_outcomes`，**不写 contacts/touchpoints**
- `sheet-followup-sync.ts:280`：写 phone 触点 source=sheet_followup；`CLIENT_FOLLOWUP_SHEETS:61` 只有 CTS
- `microsoft/mail-ingest.ts:622 syncMailbox`：写 email 触点 source=microsoft_mail；**对正文零识别**（grep 零命中）
- `messenger/link-contacts.ts:598 linkMessengerConversation`：认人 L95、写 messenger 触点 L681
- `crm/stage-from-conversation.ts`：AI 读私信推非成交阶段（`SAFE_STAGES` 不含成交，L62）
- **`email-deal-parser` 或任何成交识别模块：未找到**（本次 C3 的价值）

### 11.6 今日待办 CRM 相关
- `dnc_maybe_wrong` `manual-crm-items.ts:pushDncReviewItems L171` → href `/crm/all?contact=`
- `dm_maybe_stop` `pushMessengerStopItems L297` ← `messenger-stop-signal.ts:findMessengerStopSignals L202`
- `email_reply_due` / `email_sync_stale` `email-reply-items.ts:44` ← `email-reply-due.ts:findEmailRepliesDue L432`
- lead-followup 走 Inngest 每日汇总邮件 `crm-lead-followup-digest.ts`，不进今日待办
- **新增 `crm_stage_suggestion` kind**（C4）：跟以上三种同一 href 落点

### 11.7 硬编码清单（本次能收就收，收不了记 ROADMAP）
- `all/page.tsx:30 NAL_CLIENT_ID` + L443 判 NAL 弹金额面板 → 保留
- `sheet-followup-sync.ts:61 CLIENT_FOLLOWUP_SHEETS`（只有 CTS）→ **C2 顺手改成读客户配置**
- `link-contacts.ts:62 BUSINESS_EMAIL_DOMAINS=['ctstours.co.nz']` → **C3 改成读 `clients.brand_aliases`**
- `note-parser.ts:494 CTS_BRAND_TERMS` + L536 兜底 → **C3 顺手改成读客户配置**
- `stage-from-conversation.ts:278` 提示词写死 CTS Tours NZ → 本次不动（成交识别不走这条路），记 ROADMAP
- `conversions/cts-crm-sheet-sync-run.ts:39 CTS_CLIENT_ID` + L40 SPREADSHEET_ID + L45 域名 → 本次不动（表格→purchase 是独立路径）
- `pm-todo/daily-todo.ts:89-92 FOCUS_CLIENT_IDS`（CTS + Oztop）→ 本次不动
- `qualified-buyer.ts:198` / `contact-board.ts:110` 写死 `'qualified'` stage_key → 本次不动

### 11.8 测试
- `src/lib/crm/__tests__/` 41 个 → 复用
- 路由测试有：dnc/email/messenger/stage/timeline；**无测试**：today、contacts(GET/POST)、touchpoints、touchpoints/batch、pin、snooze、segment-feedback → C0 顺手补 contacts GET 的测试
- 页面测试 6 个 → all 页有测试可扩，crm/page.tsx 无测试可退役

### 11.9 方案外的顺带发现（不进本次，记 ROADMAP）
- `crm/page.tsx` 的"系统提议改阶段" `suggestedStage`（today/route.ts L468-578）如果 PM 舍不得，可以在列表页搞一列"系统建议"——本次先不做
- `today/route.ts` 里 `tailor_made_itineraries` L186 提议"已报价"、正则 `/报价|行程单|quote/` L551 → 这两个是行业层，未来搬进 `travel` playbook

## 12. Reuse Statement
- 复用：`contacts` / `contact_touchpoints` / `contact_identities` / `contact_stage_events` / `client_pipeline_stages`、`advanceContactStage`、`parseNote`、`segmentContact`、next-step 判据、`timeline` 接口、`CUSTOM_COLUMNS`、`me_sale_outcomes`、`autoFetchMetricValue`、Inngest `lead-sheet-sync`、pm-todo 三件套
- 新增 platform-shared：服务端分页读模型（含 SQL 聚合下沉）、表组件、成交识别器（纯函数，含同行判据 + 反转词 + 无金额降级）、备注增量读取、`crm_stage_suggestion` 待办 kind、`crm_important_due` 待办 kind、`clients.crm_config jsonb`（服务端配置，与偏好列 `crm_list_prefs` 分开）、T6 强证据速报邮件
- industry-specific：无（付款词表通用；行业词进 playbook 时再说）
- client-specific：阶段配置、列偏好、排除域名、币种、同行域名、表格 ID、备注列字母——全在 `crm_config`
- 落点与 tier-gate 判定一致：既有 L1 升级，不新建能力线

## 13. 验证清单（对齐 §7 定量验收）
- C0：聚合口径变异测试红一次；同一筛选人数与老表 3 个阶段对得上
- C1：板桥 C1 前 30 分钟真人访谈完成；C1 上线 3 周后 CTS 员工"打开老表 vs 打开 ME"天数比 ≤0.3
- C2：老表新增 3 条备注 → 次日触点 +3，重跑不重复
- C3：179 封回放集 100% 落定到 6 种状态；强证据命中 ≥50%、误判 <5%、同行 0 误伤
- C4：一封"已付定金 $500"邮件 → 阶段 deposit_paid、`me_sale_outcomes` +1、T6 速报邮件到达 PM、目标 `ce537a96` current_value 更新、receipt 可查；一封同行邮件 → 只出建议不自动写
- C5：旧路由访问返 404 测试红一次；grep 所有邮件模板/Inngest digest 里 `/crm/today`/`/crm/decisions` 结果 = 0
