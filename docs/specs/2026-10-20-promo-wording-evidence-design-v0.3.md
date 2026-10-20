# 推广计划「对外措辞已获客户同意」：文案放进计划，核实时存快照（设计稿 v0.3，只设计不写代码）

来源：PM 10-20 经统筹 18 号转述。v0.1、v0.2 独立审查各给「改设计再审」；v0.2 审查认可「第一刀不读 Meta」（可行性、安全已解决），本稿 v0.3 按审查的 9 条必改重写。
风险级：**B**（改 .ts/.tsx 与核实记录写入；不读 Meta、不碰任何令牌）。状态：待独立审查。

## 对 v0.2 的更正（审查逐条对照代码核实过）
1. 事实：spec 的跨字段校验函数是 `crossFieldIssues`（`promo/spec.ts:207`），不是 `validatePromoSpec`；备注输入要加在 `GateList.tsx:44` 的「我已核实」按钮处，不是 `_client.tsx`。
2. 已批准/已完成计划内容被锁（`plan-guard.ts:18`，`CONTENT_LOCKED`）：老计划「补文案」必须**先退回草稿**，不能直接补。
3. 禁用词「无命中」可能是假放心：CTS 的词表现在只有「since 1928」这类，没有倒计时/余位类词。
4. 「不要求每个素材有文案」会让部分覆盖也变绿。
5. 服务端取「当前」文案，PM 屏幕上看到的和落库的可能已不同。
6. 「不对客户员工展示」不成立：`marketing-plan/route.ts:20,35` 已把整份 `plan_data` 发给付费客户档。
7. 去重只按素材不够。
8. `z.string().url()` 放行 `javascript:`。
9. 表单没有文案输入（`StepFields.tsx:11` 的 `AdsFields`），PM 自己没法录入。

## 第一刀（一个 PR，B 级）

### 1. spec 字段
`adsStep.settings` 新增**可选**字段 `copy`：
```
copy: z.array(z.object({
  creative_ref: z.string().min(1),
  headline: z.string().min(1).max(80),
  primary_text: z.string().min(1).max(500),
  cta: z.string().min(1).max(40),
  landing_url: z.string().max(500).refine(isHttpsUrl),   // 只收 https（new URL 解析，协议必须是 https:）；javascript:/data:/http: 一律拒
})).max(20).optional()
```
- 老 spec 不写这个键：编辑器保存时**不能写 `copy: undefined`**（序列化会变 null、改指纹）；没有文案就整个键省略。
- **金标测试**：一份没有 `copy` 的旧 spec，`promoContentHash` 与改动前逐字相同（把改动前算出的指纹写进测试常量）；有 `copy` 后指纹变化；只改 `checks` 指纹不变。
- `crossFieldIssues`（`spec.ts:207`）加：`copy[].creative_ref` 必须在同一步骤 `creative_refs` 里；同一步骤 `creative_ref` 不重复；**覆盖要求**见 §4。
- **落地页域名限制**放在保存接口（`promo/route.ts` PUT，和「广告账户属于同一客户」的服务端校验同处），不放 spec 纯校验：`landing_url` 的主机名必须等于或是客户登记的官网域名的子域名。客户域名从客户记录读取（具体字段名实施前先查库核实；本稿不假设）；**读不到客户域名 → 拒绝保存带 `landing_url` 的文案**，提示「先登记客户官网域名」。

### 2. 页面展示（`GateList` 下的新组件）
在 `content.wording_permission` 下展开该阶段的文案，**去重键 = 素材 + 标题 + 正文 + 按钮 + 落地页**（不是只按素材）。每块固定标注：**「计划自述，未对照 Meta 里实际创意」**。禁用词命中标红；禁用词检查的结果显示「已用 N 条禁用词检查」（N 取自 `redlinesChecked`，沿用 `draft-and-gate.ts:176` 的做法，被丢弃的词用 `redlinesSkipped` 列出）。词表读不到（`loadDraftRedlines` 返回 null）→ 显示「禁用词表读不到」且核实按钮禁用。「无命中」旁加一句：「词表只有 N 条，不代表措辞没有问题，仍以客户确认为准」。

### 3. 表单录入（补审查第 9 条）
`StepFields.tsx` 的 `AdsFields` 在每个已选素材下加文案输入（标题/正文/按钮/落地页），仅草稿可编辑；未填的素材标「这条素材没写文案」。保存走现有 PUT（带 `expected_updated_at`）。

### 4. 核实快照与门槛
- `PromoManualCheckRecord`（`marketing-plan/types.ts`）新增可选 `snapshot`：`{ copy（该阶段去重后的文案）, fingerprint, redlines_checked, redlines_skipped, redline_hits, plan_updated_at }`。老记录没有它，读取不受影响。
- **覆盖门槛（补第 4 条）**：该阶段每个广告步骤的**每一个** `creative_ref` 都必须有对应文案，且该阶段至少有一个素材，才能核实；部分覆盖 → 拒绝（409），原因「N 条素材缺文案：xxx」。
- `/promo/verify` 对 `content.wording_permission`：请求必须带页面当时看到的 `expected_updated_at`，与服务端计划 `updated_at` 不一致 → 409「文案在你看过之后变了，请刷新再核实」（沿用 `promo/route.ts:64` 的乐观锁写法）。服务端**自己**取当前文案、重算禁用词，把 `plan_updated_at` 一并写进快照；词表读不到、无文案、有命中 → 拒绝。
- **备注必填**（≥10 字：客户在哪、何时、怎么确认的），输入框加在 `GateList.tsx:44` 按钮旁；接口本来就收 `note`，只补 UI 与校验。其它核实项不变。
- 谁能核实：沿用 `requirePlanApproverAccess`。

### 5. 谁能看到文案（更正第 6 条）
不再说「不对客户员工展示」。`marketing-plan/route.ts` 现状就是向付费客户档返回整份 `plan_data`，文案属于客户自己的推广计划，让客户看到自己的广告词本身也有助于确认；第一刀**不改这个接口**，文档如实写明。核实动作仍只有批准人能做。

### 6. 兼容与老计划（更正第 2 条）
- 没有 `copy` 的计划：解析通过；页面显示「计划里还没有文案」，核实按钮禁用。
- 已批准/已完成的计划被锁：提示改为「先把计划退回草稿，再在表单里补文案，改完重新批准」，**不提供**绕过锁的入口。
- 旧核实记录不动，不追溯作废；只对**新**核实要求快照。

### 7. 测试清单
金标指纹（旧 spec 不变、不写 `copy: undefined`）；`javascript:`/`data:`/`http:` 落地页被拒、非客户域名被拒、读不到域名被拒；覆盖门槛（部分覆盖被拒）；去重键（同素材不同文案分开显示）；禁用词词表为空/很短/读不到三种；`expected_updated_at` 不一致 409；快照写入含 `redlines_checked`；老计划页面提示与按钮禁用；已批计划提示「先退回草稿」。

## 后续（不在第一刀）
- **补客户禁用词**：CTS 词表补倒计时/余位类词（客户配置，不进共享代码），否则「无命中」参考价值低——这是配置工作，单独做。
- **第二刀：对照 Meta 实际创意是否与计划文案一致**（先要有「广告连接键」，建广告后回写 ad_id；只对 `owned_by_client` 的户；`requirePlanApproverAccess`；按需读取+缓存）。
- **第三刀：`landing.item_live`（硬闸）** 同类问题：核实落地页时服务端取标题/价格/日期存快照。

## 不做
不写/不改客户文案、不替客户确认、不读 Meta、不改批准流程、不改 `marketing-plan` 列表接口。

## Reuse Statement
复用：`PromoSpec` / `promoContentHash` / 核实记录与 `/promo/verify`、`draft-redlines`（`loadDraftRedlines`、`findRedlineHits`、`redlinesChecked` 做法）、PUT 保存接口的乐观锁与服务端校验位置。新增：spec 可选字段、展示与录入组件，平台通用，无客户名/行业词；禁用词与客户域名来自客户配置（client-specific，不进共享代码）。
