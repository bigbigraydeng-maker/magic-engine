# 推广计划「对外措辞已获客户同意」要核实的东西，后台得能看见（设计稿 v0.1，只设计不写代码）

来源：PM 10-20 经统筹 18 号转述。风险级：C（只读展示）。状态：待独立审查后再动手。

## 问题
`gates.ts` 的 `content.wording_permission`（hard:false）让 PM/FDE 去「确认对外措辞」，可推广计划的数据结构（`PromoSpec`）没有文案字段，广告审批页也不显示文案，文案只存在于 Meta 的广告创意里。系统在让人确认一件它自己从不展示的东西。

## 方案（只读，不写任何数据）
1. **在这一项下面直接展示将要对外的文案**：每条广告的标题、主要文字、按钮（CTA）。
2. **数据来源优先 Meta 创意（只读）**：沿用 `src/lib/meta/graph-read.ts` 的 `metaGraphGet`（只读封装，已带路径白名单与超时）。读 `act_<账户>/ads`，字段 `name,effective_status,creative{id,title,body,call_to_action_type,object_story_spec,effective_object_story_id}`——路径 `act_X/ads` 在现有白名单内，**不需要新增读取封装或放宽白名单**。按计划里广告步骤绑定的广告账户与已建草稿广告匹配。
3. **标读取时间**：每块展示「读取于 YYYY-MM-DD HH:mm」，读取时间也进核实记录描述（核实的是「看到的那一版文案」）。
4. **读不到就老实说**：显示「读不到（原因：授权过期 / 没权限 / Meta 暂时不可用）」，并给 Meta 创意预览直达链接（广告管理器里该广告的预览页）；绝不显示空白当作没有文案，也绝不让「已核实」按钮在读不到时看起来像有证据。
5. **核实按钮绑内容版本**：沿用现有 `content_hash` 失效机制不改；新增的只是展示。文案变了（读取结果与上次核实时不同）时，在展示里提示「文案在你上次核实之后变过」——此提示需要把读取到的文案指纹存进核实记录，属于后续小改，先列为可选。

## 没有草稿广告怎么办
计划只有「预算/受众/素材引用」时，Meta 里还没有创意：显示「这条广告还没建，没有文案可核对」，并说明文案来源将是广告草稿（`AdDraftCreative` 的 headline / primaryText / description）。草稿落库后同一展示改读草稿，不需要读 Meta。

## 其它 hard:false 的人工核实项各能展示什么证据
当前 `gates.ts` 里不阻止批准（hard:false）的项目：
| 项 | 来源 | 现在 PM 看到什么 | 建议展示的证据 |
|---|---|---|---|
| `content.wording_permission` 对外措辞已获客户同意 | 人工核实 | 一句话「把稀缺性/截止日发给客户确认」，看不到措辞 | 上面的文案块 + 读取时间 |
| `social.cadence_scheduled` 社媒节奏已排 | 工具（每日计划覆盖天数） | 「已排到往后 N 天」 | 可以加：覆盖到哪一天、缺哪几天（读每日计划，已有数据） |
| 开投前追踪检查里 hard:false 的五项：`tracking.lead_event_quality`、`tracking.ga4_events`、`tracking.capi_ready`、`post.t1h`、`post.t24h` | 回执 | 每项一句原因 | 回执里已有 `reason/how/as_of`；缺的是把「检查了什么」展开成可点开的明细（后续，不在本稿） |
（硬闸 `landing.item_live` 同样是「让人核实却看不到落地页内容」，同一类问题；本稿不动，留给后续同构方案：展示落地页标题+价格+日期的读取快照。）

## 不做
- 不写文案、不改文案、不替客户确认；不改 `PromoSpec` 结构与批准流程。
- 不新增能力线；复用现有只读 Meta 封装与草稿结构。

## 实现要点（留给独立审查）
- 新增一个纯函数「把 Meta 读回的 creative 整理成人话一行」+ 一个只读 API（server 端读 Meta、带 `as_of`），页面组件只渲染。
- 客户令牌/账户绑定沿用现有 `client-ad-accounts` 约定，不把令牌送到浏览器。
- 读取失败的各种错误码（`reconnect_required` / `permission_required` / `provider_rate_limited` …）各给一句人话。

## Reuse Statement
复用：`metaGraphGet`、`AdDraftCreative`、现有 content_hash 核实机制。新增（若动工）：只读展示函数与组件，平台通用，无客户名/行业词；无客户私有事实进共享代码。
