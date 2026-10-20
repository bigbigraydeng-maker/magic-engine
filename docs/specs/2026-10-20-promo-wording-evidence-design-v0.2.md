# 推广计划「对外措辞已获客户同意」：把文案放进计划，核实时存快照（设计稿 v0.2，只设计不写代码）

来源：PM 10-20 经统筹 18 号转述。v0.1 独立审查结论「改设计再审」，本稿按审查意见重写。
风险级：**B**（改 .ts/.tsx 与核实记录写入；不读 Meta、不碰任何令牌）。状态：待独立审查。

## 对 v0.1 的更正
**事实更正**
- 广告审批页其实有显示文案（`dashboard/ad-approval/page.tsx:129-153`「买家会看到这些字」）；但生产库没有 `ads.create_ad` 记录，v0.1「没有草稿就改读草稿」的兜底落空。
- 「其它五项」说错了：`post.t1h` / `post.t24h` 不在计划检查清单里（`ads-tracking-preflight/types.ts:31`）。`hard:false` 的人工核实项只有 `content.wording_permission` 一项（`promo/gates.ts:41` 的 `MANUAL_GATE_KEYS` 含两项，另一项 `landing.item_live` 是硬闸）。

**设计更正（v0.1 作废的部分）**
- 作废「只读 Meta 创意」：计划步骤没有「广告连接键」（CTS 草稿计划 5 个素材 ref 与账户 17 条广告的 video_id 一个都对不上）；共享令牌回落时账户级挡不住串读（`meta/token-selection.ts:35`、`meta/campaign-ownership.ts:14`）；帖子加推/`asset_feed_spec` 的文案抓不到。
- 作废「绑内容版本」的说法：`promoContentHash` 虽然对整份 spec 取指纹，但 spec 里目前没有文案，所以文案根本不在指纹里；核实记录也没有文案快照。
- 作废「C 级 / 只读」：本稿要写核实记录，按 B 级。

## 第一刀（一个 PR，B 级）：文案放进计划
**原则**：PM 核实的东西必须是系统自己存着、自己展示的东西。文案由录入计划的人（105/74）和建广告同一份给出，放在计划里。**不读 Meta。**

### 1. spec 字段（`promo/spec.ts`，`adsStep.settings`）
新增**可选**字段 `copy`（老计划没有它，照常解析）：
```
copy: z.array(z.object({
  creative_ref: z.string().min(1),   // 对应 creative_refs 里的素材
  headline: z.string().min(1).max(80),
  primary_text: z.string().min(1).max(500),
  cta: z.string().min(1).max(40),
  landing_url: z.string().url().max(500),
})).max(20).optional()
```
校验（`validatePromoSpec` 里加）：`copy[].creative_ref` 必须出现在同一步骤的 `creative_refs`；同一步骤内 `creative_ref` 不重复。不要求每个素材都有文案（缺的在页面上标「这条素材没写文案」）。

### 2. content_hash 包含文案
`promoContentHash` 现状只排除 `checks` 与 `gate_snapshot`，其余整份 spec 都进指纹——所以 `copy` 加进 spec 就**自动**进入指纹，文案一改，旧核实自动失效（已有机制，无需改哈希函数）。要在测试里钉死：改任一字 → 指纹变；只改 `checks` → 不变。

### 3. 页面展示（`GateList` / 新增小组件）
在 `content.wording_permission` 这一项下展开显示该阶段的文案，**按阶段 + 素材去重**（核实按阶段做，`promo/verify/route.ts:36`；同一素材在多个步骤只显示一次）：
- 每条：素材 ref · 标题 · 正文 · 按钮 · 落地页。
- **禁用词标红**：服务端用 `loadDraftRedlines(supabase, clientId)` + `findRedlineHits(texts, phrases)` 对该阶段所有文案文字做检查，命中的词随展示数据返回，页面标红并写「含禁用词：xxx」。`loadDraftRedlines` 读不到（返回 null）→ 显示「禁用词表读不到，没法检查」，且**核实按钮禁用**（读不到不能当没问题）。
- 老计划没有 `copy` → 显示「计划里还没有文案」，核实按钮禁用并写明原因：「先让录入计划的人把对外文案补进计划」。

### 4. 核实记录存快照 + 必填备注
- `PromoManualCheckRecord`（`marketing-plan/types.ts:162`）新增可选字段：`snapshot?: { copy: AdsCopy[]（该阶段去重后的文案）; fingerprint: string; redline_hits: string[] }`。老记录没有它，读取不受影响。
- 服务端 `promo/verify/route.ts`：对 `content.wording_permission` **在服务端自己取当前文案**（不信客户端传来的）、重算禁用词，写入 `snapshot`；该阶段没有文案、或禁用词表读不到、或命中禁用词 → 拒绝（409，原因一句人话）。
- `note` 对这一项**必填**（≥10 字，写「客户在哪、何时、怎么确认的」）；`_client.tsx:105` 的核实按钮加备注输入框。其它核实项维持不变。
- 谁能核实：沿用现有权限；新增的展示数据接口（若需要）用 `requirePlanApproverAccess`（现在 GET 含客户员工，`promo/route.ts:34`），文案属于对外措辞草稿，不对客户员工展示。

### 5. 兼容现有计划
- 已批准/草稿计划没有 `copy`：解析通过、页面显示「计划里还没有文案」，核实按钮禁用并提示；**不改任何已有核实记录**，已核实的旧记录因 `content_hash` 与 `snapshot` 缺失仍按现有逻辑显示（有记录且指纹一致=绿）。第一刀不追溯作废旧核实，只在**新**核实上要求快照。
- 文案补进计划后指纹变化 → 旧核实自动失效，需要重新核实（符合预期）。

### 6. 测试清单
spec 解析（有/无 copy、creative_ref 不匹配被拒）；指纹随文案变化；去重；禁用词命中与读不到；verify 路由：无文案/读不到禁用词表/命中禁用词被拒、备注必填、快照写入、旧计划兼容；页面：老计划显示提示且按钮禁用。

## 后续（不在第一刀）
**第二刀：对照 Meta 实际创意是否与计划文案一致**——用 74 的读回、按本计划的广告 ID、只对 `owned_by_client` 的户、接口用 `requirePlanApproverAccess`、按需读取+缓存、标读取时间；读不到显示原因+预览链接；帖子加推广告抓不到文案就明确标「抓不到」，不留白。先决：计划步骤要有「广告连接键」（建广告后回写 ad_id），这是另一个小设计。
**第三刀：`landing.item_live`（硬闸）同类问题**：让人核实落地页却看不到内容；后续同构方案（核实时服务端取落地页标题/价格/日期存快照）。

## 不做
不写/不改客户文案、不替客户确认、不新增读取封装、不读 Meta、不改批准流程。

## Reuse Statement
复用：`PromoSpec`/`promoContentHash`/核实记录与 verify 路由、`draft-redlines`（`loadDraftRedlines`/`findRedlineHits`）。新增：spec 可选字段与展示组件，平台通用，无客户名/行业词；禁用词来自客户配置（client-specific，不进共享代码）。
