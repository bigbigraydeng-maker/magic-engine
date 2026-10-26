# 设计 v2 · ME Meta 广告「受众管理 + 类似人群」能力（补齐 L1 广告执行层缺口）

风险级 **A**（L1 平台能力 · 动 shared runtime `src/lib/meta` · 影响已上线广告栈）。设计阶段产出。

**v2 修订记录**：吸收 2026-09-06 子牙（架构，DESIGN OK + 5 约束 + 2 裁决）+ 魏征（挑刺，DESIGN NEEDS REVISION：B1–B4 阻断 + M1–M4 中等）双审，并按 PM 决策补入「名单受众（第二期，带同意治理）」——来自旁边窗口「🌈Meta广告lead成交数据上报」的真实证据（CTS 193 FB广告 + 526 newsletter 名单）。

平台候选登记：`docs/registry/platform-candidates.md`（2026-09-06，复查 2026-10-06）。

---

## 1. 背景与现状（Explore 全栈盘点）

ME 广告栈 = `operating_legacy`（已上线真跑）。治理链 `draft-and-gate`（起草→建成 PAUSED→回读核对→人点头审批→execute），回流 `MetaAdsAdapter`（pull→snapshot→flywheel_metrics→Check/Tune）。

`src/lib/meta/audience-ladder.ts` 已成熟：`planLadder`（纯）+ `createLadder`（执行，按名去重，逐项报），建 Engagement 受众，全参数化。

**三个缺口**：① `createLadder` 无 caller（未接线）② 无 Lookalike ③ 无 website/pixel 受众。**外加旁边窗口暴露的第四块**：④ 客户名单（PII）受众——现被手工顶（CSV/Mailchimp 直连 Meta），无平台治理。

---

## 2. 目标 / 非目标（v2 更新）

**目标**：补齐上述缺口，全部复用现有治理 + 回流，红线 2 合规。

**分期非目标（v2 改）**：
- 第一期**不做**名单（PII）上传——但**不再是永久非目标**，改为**第二期做，且必须自带同意治理**（谁同意 / 什么基础 / 审计留痕 / hashing 规范）。理由：旁边窗口证明 526 人 newsletter 名单是刚需，子牙也指出这是「最该有独立治理设计」的块。
- 始终**不做**：新增广告支柱以外能力线（红线 1）；把广告栈迁进 kernel（本次不扩 scope）。

---

## 3. 第一期设计（Lookalike + 接线，不依赖腿A/地基）

### 块 A · Lookalike 创建（核心）

新文件 `src/lib/meta/audience-lookalike.ts`：

```ts
export interface LookalikeSpec {
  clientCode: string
  adAccountId: string
  seedAudienceId: string
  seedScope: string
  ratio: number       // 无默认值，必须注入
  country: string      // 无默认值，必须注入
}
export function planLookalike(spec): LookalikePlanItem       // 纯，可测
export async function createLookalike(spec, token): Promise<LookalikeResultItem>
```

**吸收 B1（红线 2 破防）**：`ratio` / `country` / `seedAudienceId` **零默认值**——shared 代码里不许出现 `?? 0.01` / `?? 'NZ'`。缺任一 → 返回 `outcome:'missing_config'`，**不 fallback**。§3 v1 注释里「对齐 CTS 0.01/NZ」这句删除，避免实现者拿它当默认。

**吸收 B4（命名 bug）**：
- 命名 `{CODE} · LAL · {seedScope} · {pct}pct · {country}`，其中 `pct = Math.round(ratio*100)`（杜绝 `0.07*100=7.000…1` 浮点尾巴），**且必含 `country`**（否则 NZ/AU 同种子同比例撞名，第二个被误判已存在跳过）。

**吸收 B2/B3（种子门槛）**：
- Meta 要求种子 ≥100 人。`listCustomAudiences` 只回 `id,name`，**拿不到人数** → 只能**事后捕获**，不能事前预检（设计不许暗示能预检）。
- 2026-10-26 起 operation_status 与 approximate_count_lower_bound 可读（见 draft-and-gate.ts checkAudiences），事前预检已可行；注意 count 小受众会返回 -1/0 表示不报。
- 靠 Meta error subcode 判定，映射独立 `outcome:'seed_too_small'`，与通用 `failed` 分开，不静默吞（对照 `createOne` 现在一律 `throw` 成一坨 `failed` 的问题）。
- **绝不对同一次运行里新建（0 人）的受众建 lookalike**——接线层只对「已存在且非本轮新建」的种子建。新建种子这一轮跳过，下一轮人长起来再建。

**吸收子牙非阻断（种子归属自检）**：建 lookalike 前用已拉的 `listCustomAudiences` 结果确认 `seedAudienceId` 确实属于目标 `adAccountId`，挡「抄错种子 id、拿别家受众当种子」。

### 块 C · 接线（触发入口）

新路由 `POST /api/clients/[id]/meta-ads/audiences`：
- `requirePaidClientAccess` 鉴权。
- **吸收子牙唯一红线**：此路由**只能建受众，绝不能把受众挂进 ad set 或激活任何广告**（那会绕过钱闸）。路由代码 + PR 描述写死这条。
- **吸收 B3**：内部顺序 = 先 `createLadder`（建/补规则受众）→ 只对「已存在 ≥1 轮的受众」`createLookalike`。首轮只建 ladder、不建 lookalike。
- **吸收 M4**：`seed_too_small` / `gaps` / `failed` 除进 `flywheel_actions`，**必须有人能看到的落点**——复用 `src/lib/pm-todo/manual-items.ts`「🙋 需要你动手」栏（不许只落 audit，否则 cron 调用时违反「发现不许死日志」）。

---

## 4. 第二期设计（v2 新增 · 名单受众 + website 受众）

### 块 D · 客户名单受众（收编旁边窗口手工流程）

- **能力**：把客户名单（email/phone）建成 Meta customer_file custom audience，作为 lookalike 种子 / 再营销池。
- **必带同意治理（不可选）**：每条记录必须携带同意来源（`ad_form` / `newsletter_subscribe`）+ 同意时间；退订 / 失效邮箱强制排除；上传走 Meta 的 hashing（明文不出 ME）。
- **收编触发**：本块上线即替换旁边窗口的手工 CSV / Mailchimp 直连（统筹广播 #1 已约定）。
- 命名前缀 `CTS · LIST · {来源} · {日期}`（已与旁边窗口约定分区）。
- ⚠️ 本块单独走一次设计+审（PII + 同意合规，风险高于第一期），不与第一期混提。

### 块 B · Website/pixel 受众（依赖 CAPI 地基）

**吸收 M3**：不复用 `createOne`（它硬编码 `subtype:'ENGAGEMENT'`）。website 受众 subtype/规则形状不同（`event_sources:[{type:'pixel'}]` + url filter），需走能设 subtype 的独立路径。规则形状标注 **「未经 API 验证，第二步实测前不算数」**（现有 ladder 的 page/lead 规则是 2026-07-29 真建过才标 verified:true，本块没这待遇）。

---

## 5. 治理决策（子牙已拍板）

受众创建**自动执行 + `flywheel_actions` 记账 + 建完回读核对**，**不单独人点头审批**（不花钱/可删/不对外，不占审批三占）。钱的闸在下游广告 `draft-and-gate` 兜住。**唯一红线**：受众路由绝不挂 ad set / 激活广告（见块 C）。魏征 M4 确认此推理不绕过钱闸。

**吸收子牙约束 1**：`flywheel_actions` **直插**（`supabase.from('flywheel_actions').insert`），**绝不走 `MetaAdsAdapter.execute`**——它的 `assertAdsExpectedMetric` 要求承诺可 pull 指标，受众无指标会 throw。
**吸收子牙约束 3**：回读**核对规格**（lookalike 回读确认 `subtype=LOOKALIKE` / `origin_audience_id=种子` / `ratio` / `country` 与请求一致），不只核对「有 id」。
**吸收魏征 L1（时序）**：Meta lookalike 生成异步（pending 数小时）。回读证的是「对象存在」，**不是「就绪可用」**——文档 + 返回值说清，别让调用方误判。

---

## 6. 红线合规 + 配置单一真相源（子牙约束 5 / 魏征 B1）

- **红线 2**：`LadderSpec` / `LookalikeSpec` 全部字段（adAccountId / pageId / videoIds / leadFormIds / pixelId / **seedAudienceId / ratio / country**）从**客户配置单一真相源**注入，shared 代码零默认值、零硬编码。
- **单一真相源钉死**：与现有 `meta-ads` 路由（`execute` / `draft`）读 adAccountId / pageId 的**同一来源**对齐（实现第一步先定位该来源，`ratio` / `country` / 种子映射作为新字段挂同处），**不新造散落来源**。
- CTS 的 video id / form id / pixel / seed / ratio / country = **L4 客户配置**；通用 builder = **L1 shared**。

---

## 7. 回流（Check/Tune）

受众不产生独立 outcome；被广告使用后 `MetaAdsAdapter` 已覆盖花费/线索/ROAS。受众创建记 `flywheel_actions`（audit）。**吸收子牙约束 2**：新 `action_type`（如 `ads.create_audience` / `ads.create_lookalike`）登记进 `src/lib/flywheel/vocabulary.ts` 的 Ads action 词表，别当黑户。

---

## 8. 并发 / 翻页（魏征 M1/M2）

- **M2（翻页）**：`listCustomAudiences` 现 `limit=200` 无翻页，CTS/Oztop 共享账户受众超 200 会漏判去重 → 建重复。**必须翻页拉全**再去重。
- **M1（并发）**：`list→create` 是 check-then-act，两 worktree / 两请求并发会各自建同名重复受众。v1 声称的「重复调用安全」**只在串行成立**。处理：文档写明此局限 + 接线层对同一 client 加轻量执行锁（如 DB advisory lock / flywheel_actions 唯一约束占位），不许裸并发。

---

## 9. Inngest 决策（子牙约束 4）

受众创建是外部副作用，但为单次同步「建→回读→记账」、无 T+N 接力、无发布/扣费/对外 → **判定不上 Inngest**，替代 receipt = `flywheel_actions` 那条记录。**PR 描述必须写明此决策 + 恢复条件**（CLAUDE.md §3 硬约束）。

---

## 10. API 版本（子牙裁决）

新代码统一 **v19.0**（与 `audience-ladder.ts` 一致）。在 `src/lib/meta` 建共享常量 `GRAPH_API_VERSION='v19.0'`，新文件全 import 它。已上线文件的 v19/v20/v21 sprawl **单列 B 级清理项**，不进本 PR（不碰活代码）。

---

## 11. 分步交付

- **第一期**（本设计，不依赖腿A/地基）：块 A（Lookalike）+ 块 C（接线）。用 CTS 已有 video-50 / ThruPlay 受众做种子。
- **第二期-D**（名单受众，收编旁边窗口）：块 D，**单独走 PII + 同意合规设计+审**。
- **第二期-B**（website 受众，依赖 CAPI 地基通）：块 B。

---

## 12. 复用声明 + product-map 登记（子牙非阻断）

复用：`audience-ladder.ts` / `draft-and-gate` readback 理念 / `flywheel_actions` 记账模式 / `token-manager` / `requirePaidClientAccess`。不另起 Graph 客户端、不新建审批体系、不新建表。
**吸收子牙非阻断**：新增受众 builder 后，把它作为 ads 泳道的 capability 补登记进 `src/lib/product-map/registry/ads.ts`，别让接线后的能力在台账上又变隐形。

落点：通用 builder + 路由 = L1 shared；客户 spec 值 = L4 config。与 tier-gate 决策一致。

---

## 13. AD-SEC-1（同账户跨客户，非阻断）

受众建在 CTS/Oztop 共享账户，`clientCode` 前缀是命名隔离非安全隔离，同广告栈已知缺口，本次不扩 scope（种子归属自检见块 A 已加轻量挡低级误操作）。

---

## 待子牙终审确认点

1. B1 配置 provenance（§6「与现有 meta-ads 路由同源」）是否够钉死。
2. M3 website 受众独立 subtype 路径方向是否认可（第二期-B 实测前不算数）。
3. 第二期-D（名单受众）拆成独立设计+审，是否同意。
