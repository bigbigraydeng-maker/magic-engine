# 发布日历设计稿 v0.4 补充：每周整包确认卡（Story + 图文 + Reel）

- **日期**：2026-11-01（新西兰）｜ **风险级**：A（合并三条发布线的授权，最终会决定对外发什么）
- **状态**：方案已定（Ray 2026-11-01 17:34 NZDT）。Ray 2026-11-01 17:38 NZDT 说 go 之后，v1 写在默认关闭的两个开关后面：整包批准、Reel 批准即转公开。开关关闭时不会授权、不会转公开。没有新建表，没有改各线自己的发布开关。
- **基线**：`main` @ `d98c48f`（2026-11-01，本机只读核实）。
- **与 v0.3 的关系**：[`2026-10-14-publishing-calendar-design.md`](./2026-10-14-publishing-calendar-design.md) v0.3 的 §4「一周一次授权」、§6 第②步「一处授权」仍成立。本稿**不另起产品名**，只在 v0.3 之上补「怎么用一张确认卡一次办好三条线各自已有的授权函数」。第①步只读日历仍由 [`week-overview`](../../src/lib/social/week-overview/build.ts) 承接；候选表 / 自动报名仍属 v0.3 第②步远期，本稿不展开。
- **来源**：flow-plan 社媒第 4 步；[`2026-10-19-social-agent-playbook-and-rules-v1.0.md`](../sops/2026-10-19-social-agent-playbook-and-rules-v1.0.md) §9.1；开发说明 B（weekly whole-pack approval）。

---

## 0. 给 PM 的一页话

**要解决的事**：Story、图文、Reel 现在各有一条「预览 → 点一次授权 → 到点自动发」的线，但授权入口分散（Story 预览页、每日计划接口、工厂逐条转公开）。你要的是**每个客户每周一张「下周整包」确认卡**：卡上按天列出全部 Story、图文、Reel；你在**自己的会话里点一次「同意」**，三条线各自调用**现成的**授权函数；之后若某条被改过或发前检查不过，**只拦那一条**，并单独进今日待办，不撤销整包授权。

**卡只是入口**：不新写发布器、不新写单条拦截逻辑、不改各线指纹算法。

**第一版必须说清的落差**：本周总览里**图文尚未接入**（`post: { connected: false }`）；Reel 转公开仍是 [`runPromote`](../../src/lib/factory/publish/promote/action.ts) 的「预览 → 令牌 → 确认」模型；每日计划自动发**默认只演练**。整包按钮**不能假装**三类都已真发——卡上会分项写清「本线已授权 / 演练 / 尚未接入 / 需逐条预览」。

---

## 1. 代码事实（调研结论，2026-11-01）

| 话题 | 结论 | 出处 |
|---|---|---|
| Story 哪套在跑 | **`story-lite` 在跑**（Inngest `story-lite-publish` 每 10 分钟）；`story-publish/` 为已搁置切片，**整包授权不碰** | [`docs/ledger/2026-10-12-story-lite-shelved-parts.md`](../ledger/2026-10-12-story-lite-shelved-parts.md) |
| Story 授权 | `buildLitePreview` → `authorizeLitePack`（`confirm` + `expectedContentHash`）；改内容后单条 `BLOCKED` | `src/lib/social/story-lite/service.ts` |
| 图文 | 每日计划自动发：**契约**在 `daily-plan-auto-publish*.ts`，路由 `campaign-daily-plan/auto-publish/authorize`；扫描结果含 `dry_run` 状态（`AUTO_PUBLISH_ATTEMPT_STATUSES`）。**第一版整包不授权图文**（Ray 已定）。并列「Post 最小版」仅设计稿，**未建表** | [`2026-10-14-post-lite-design.md`](./2026-10-14-post-lite-design.md)、`daily-plan-auto-publish.ts` |
| Reel | 工厂发布器默认草稿；转公开 `runPromote`（预览 TTL 5 分钟、按管理员邮箱分槽） | `src/lib/factory/publish/promote/` |
| 确认卡 | `issueConfirmationCard` / `decideConfirmationCard`；**卡面有效期 30 分钟**（`CONFIRMATION_TTL_MS`）；**agent 可出卡不可点**，OPC / 负责该客户的 FDE 可点 | `src/lib/confirmation-card/` |
| 本周视图 | 读 Story 包 + 工厂 Reel；**无图文列** | `src/lib/social/week-overview/build.ts` |
| 发前检查 | 价格闸、对外声明、内容审查、Story 视频检查等**各线已有**，整包服务只**汇总展示**为卡的 `hardChecks`，不复制规则 | `src/lib/content/price-claim-gate.ts` 等 |

---

## 2. 整包清单（Week Pack Manifest）

整包不是新表（第 2 步若需持久化再单开 A 级 PR）。第 2 步实现时，**每次出卡前**用只读组装器生成一份 **Manifest**（内存结构 + 写入确认卡 `scope` / 指纹输入）：

| 字段 | 说明 |
|---|---|
| `client_id` | 客户 |
| `week_start` / `week_end` | 新西兰日期，通常周一～周日「下周」 |
| `story` | 可选：`pack_id`、包级 `content_hash`、条目列表（`item_id`、渠道、计划时刻、条目指纹） |
| `posts` | 第一版 **不授权**：只读占位或空；scope 标 not wired yet |
| `reels` | 工单列表（`work_order_id`、建议发布日、`promote` 用内容指纹、当前 `video_state`） |
| `assembled_at` | 组装时间（**不进**内容指纹，与确认卡惯例一致） |

**清单来源（只读，与 week-overview 对齐并扩展）**：

- Story：与 week-overview 相同规则——优先已授权且在有效期内的包，否则最新草稿包。
- Reel：与 week-overview 相同工厂查询；只纳入「审查已过、仍草稿、落在下周窗口内」的条目（具体过滤在第 2 步 PR 写死，本稿要求：**没读到的行必须报「读不到」**）。
- 图文：**第一版只读占位**（`connected: false` / 文案「尚未接入」），**不进整包授权**（Ray 已定）；可挂 `social_plans` 只读行供 PM 看，不调用 authorize。

---

## 3. 确认卡：一个入口，三条线各走各的授权

### 3.1 出卡（issue）

**每次打开本周总览页时**调用 `issueConfirmationCard`（指纹不变则复用 pending 卡）；卡面仍 **30 分钟** TTL，不改 policy（Ray 已定）。cron 仅按客户节奏配置提醒「该批了」，不替代出卡。

**卡事实（`CardFacts`）建议**：

| 字段 | 示例内容 |
|---|---|
| `subjectKey` | `social:week-pack:<clientId>:<weekStart>`（仅小写/数字/`:_-`，符合现有校验） |
| `what` | 「同意按清单发布下周 Story / 图文 / Reel；改过的条目会单独拦下。」 |
| `date` | 「2026-11-02 至 2026-11-08（新西兰，周一～周日）」 |
| `scope` | 分项计数与状态：Story 18 条、Reel 3 条、图文：尚未接入（not wired yet） |
| `account` | 客户显示名（无生产编号） |
| `amount` | 「无额外广告花费」或「不涉及预算」 |
| `hardChecks` | 汇总只读检查结果（绿/红/读不到），例如「Story 包级可授权」「Reel 3 条已过画面审查」「图文线路演练中」 |

**指纹（回答设计问题 §3.2）**：

1. 对 Manifest 中**每一条**取稳定元组：`(kind, stable_id, per_item_fingerprint, scheduled_at_iso)`。  
   - Story：`stable_id = item_id`，指纹用 story-lite 已有条目指纹 / 包内映射。  
   - 图文：`stable_id = plan_id + date`（或 post-lite 的 `item_id`），指纹用各线已有哈希字段。  
   - Reel：`stable_id = work_order_id`，指纹用 `runPromote` 上下文已有 fingerprint。  
2. 按 `(scheduled_at_iso, kind, stable_id)` **排序**后，组成数组。  
3. **卡上存的指纹**：仍走现有 [`contentFingerprint(facts)`](../../src/lib/confirmation-card/facts.ts)（只含 `CardFacts` 七字段 + `hardChecks`，**放不下**逐条条目）。Manifest 条目数组先 `canonicalHashOfInput(entries)` 得到 **清单摘要哈希**，写入 `scope` 大白话（≤180 字，例如「Story18·Reel3·摘要 ab12…ef34」），再对整份 `CardFacts` 算 `content_fingerprint`。  
4. **后加条目**：清单摘要变 → `scope` 变 → 卡指纹变 → 旧 pending 卡被 `voidStaleCard` 作废。  
5. **点同意时再比对清单**（W2 新增，非 `decideConfirmationCard` 现成行为）：编排层用当前 Manifest **重算摘要哈希**，与卡上 `scope` 里声明的一致才继续；否则拒绝并待办。各线仍各自比 `expectedContentHash` / promote 指纹。

卡的 `content_fingerprint` 字段存上述哈希；**各线自己的包哈希 / promote 指纹不改**。

### 3.2 点「同意」（decide → 编排，不改各线内核）

仅在 `decideConfirmationCard` 成功且 `decision === confirmed` 之后，由**新的编排服务**（第 2 步 PR）顺序调用，**每步 fail-closed**，并写机器可读回执（client id、subjectKey、runId、每线结果码）：

| 线 | 现成函数 / 路由逻辑 | 整包同意时做什么 |
|---|---|---|
| Story | `buildLitePreview` → `authorizeLitePack({ confirm: true, expectedContentHash: preview.content_hash })` | 与 Story 预览页相同；**须全局管理员会话**（`requireGlobalAdmin`，与 v0.3 日历页一致） |
| 图文 | （第一版不调用） | 回执 `skipped_not_wired`；v0.3「每日计划保持关着」不变 |
| Reel | 每条 `runPromote`（**#2817 合并前不跑 confirm**） | 见 §3.3、§8 |

**身份**：整卡 `decide` 仍走 `assertMayClick`（**OPC / 负责该客户的 FDE**，Ray 已定维持现状）。**agent 永远不能代点**（与 v0.3 §4 一致）。编排层不得用 service role「代 PM 补点」各线授权。

**与 Story 管理员要求的关系**：FDE 可以点确认卡，但 `authorizeLitePack` 仍可能 403。**不为此改 kernel 角色**（Ray 已定）。编排按 **§14 部分失败**处理：已成功的线不回滚，失败线进待办；运营上 Story 授权宜由 **OPC（全局管理员）** 在同一会话点整包同意。

**部分失败（Ray 已定）**：任一步失败 **不做整包回滚**；其余已成功的授权 / 步骤 **照常生效**，失败项单独待办列明细。

### 3.3 Reel：整包一点 vs 逐条 previewToken

`runPromote` **今天**要求：每条先 `previewStage` 拿 `preview_token`（5 分钟 TTL），再 `confirm: true`。

整包编排**不能**跳过 preview（代码会 403）。第 2 步实现选项（均复用 `runPromote`，不新写 Meta 调用）：

- **已定**：点「同意」前，清单内每条 Reel **必须已预览**（令牌未过期）；编排层按清单顺序带 token 确认（选项 A）。  

卡面 `hardChecks` 标明 Reel 是否「已预览可确认」。**#2817 合并前**整包 **不** 执行 promote confirm（Ray 已定）；Reel 在 Manifest 只读 + 工厂逐条转公开。

### 3.4 点「拒绝」或过期

- `declined` / `expired`：**不调用**任何线的 authorize / promote。  
- 过期后重新出卡；指纹不变且仍 pending 时可复用同一张（确认卡现有 `retireOld` 行为）。

---

## 4. 改动 / 发前检查不过的条目（回答设计问题 §3.3）

**原则**：沿用各线现有单条拦截（Story `BLOCKED`、每日计划 `blocked`、Reel promote 失败等）；**不**因单条问题撤销整包授权记录。

| 之后发生的事 | 行为 |
|---|---|
| Story 某条改图/改字 | 扫描器单条 `BLOCKED`；包级授权仍在 | story-lite sender |
| 每日计划 revision 变了 | 自动发授权整体失效（现有契约） | `daily-plan-auto-publish.ts` |
| Reel 草稿在授权后被改 | 该条 promote 409；已公开的不回滚 | `runPromote` |
| 发前检查（价格、对外声明等） | 在**授权前**进卡 `hardChecks` 标红，阻断整卡 `confirmEnabled`；授权后新触发的检查仍单条拦 | 各线现有 |

**今日待办（第 2 步 PR）** 新增两类（三件套 what / how / href）：

1. **「下周整包待批」**：Manifest 已齐、无 pending 卡或卡快过期；href 指向本周总览「批这一周」锚点。  
2. **「单独拦下 N 条」**：汇总各线 `BLOCKED`/失败条目，链到 Story 项 / 计划日 / 工厂工单页。

复用模式：[`story-lite-items.ts`](../../src/lib/pm-todo/story-lite-items.ts)、[`auto-publish-items.ts`](../../src/lib/pm-todo/auto-publish-items.ts)。

---

## 5. 撤销整包（回答设计问题 §3.8）

撤销对象：**确认卡 run**（若仍 pending 则 void）+ 各线**现有撤销**，不是新语义。

| 线 | 现成撤销 | 效果 |
|---|---|---|
| Story | `revokeLitePack` | 未发全停；已发不收回（与 story-lite 一致） |
| 图文 | `auto-publish/revoke` | 撤销 standing grant |
| Reel | **无「整包撤销已公开」**；仅未 promote 的草稿保持草稿 | 已公开 Reel 需人工处理主页 |

编排层按 Manifest 快照里**当时授权成功的线**依次撤销；回执列出 `sent` / `in_flight`（Story）等现有字段。

---

## 6. 30 分钟卡有效期（回答设计问题 §3.4）

现状：

- 确认卡：**30 分钟**（`CONFIRMATION_TTL_MS` / `policy.ts` `TTL_SECONDS`）。  
- Reel promote 预览令牌：**5 分钟**（`PREVIEW_TTL_MS`）。

**已定（Ray 2026-11-01）**：**每次打开总览现出卡** + 确认卡仍 **30 分钟** TTL；快过期提示重新打开页面。周包专用更长 TTL **不做**（除非日后单开 A 级 policy PR）。

---

## 7. 图文落差（回答设计问题 §3.5）

**已定（Ray 2026-11-01）**：**第一版整包不含图文授权**；Manifest / 卡面 scope 标 **「尚未接入（not wired yet）」**；点同意只办 Story（+#2817 之后的 Reel promote 步骤）。Post 最小版或每日计划接入 **另开 PR**，不与 W2 绑死。

v0.3 长期仍可用「候选 → 日历」统一图文；**整包 v1 不依赖候选表**。

---

## 8. Reel 与 #2817（回答设计问题 §3.6）

**背景**：PR #2817 拟修正「草稿仍被记成已发布」类问题；合并前 promote 后的展示/台账可能与主页不一致。

**已定（Ray 2026-11-01）**：整包里的 **「批准即转公开」（go-public-on-approve）等 #2817 合并并通过回归后再开**。此前：Reel 进 Manifest **只读**（含建议发布日、审查状态）；整包同意 **不** 调用 `runPromote` confirm；PM 仍在工厂逐条 preview + 确认，或 #2817 后再接 W5 批量 UX。

**审查来源（v0.3 §6b）**：Manifest 上「Reel 审查已过」只读工厂/审查流水（苏东坡事实、马良画面），**不是**编排层自盖签字。

---

## 9. 发布节奏（回答设计问题 §3.7）

**已定（Ray 2026-11-01）**：**CTS 客户配置默认**（新西兰时间）——**周四出草稿、周五批包、周一起按计划发**；其他客户可覆盖，**不写死全局 cron**。出卡待办与提醒读该配置；发送时刻仍由各线 slot（Story 08:30/13:00/20:00 等）决定。

---

## 10. 页面与入口（第 2 步 UI，本稿只定行为）

在 **本周总览**（[`week-overview`](../../src/lib/social/week-overview/)）：

- 增加 **图文只读列**（与 Story/Reel 并列），读不到报「读不到」。  
- **「批这一周」**：出卡或展示 pending 卡 → 调现有 `confirmation-cards` API；同意/拒绝后展示分项回执。  
- 顶部状态：演练 / 真发、整包 pending/已确认/已拒绝/过期、各线 authorized 摘要。

不替代 v0.3 的「按天名额进度条」；名额仍来自客户配置（week-overview 已有 `PublishingQuota`）。

---

## 11. 拆 PR 建议（回答设计问题 §3.9）

| PR | 等级 | 只做一件事 |
|---|---|---|
| **D1** | 文档 | 本稿 + 台账（已完成于设计 PR） |
| **W1** | B | Manifest 只读组装 + 单元测试（无 UI、无出卡） |
| **W2** | A | 确认卡 issue/decide 编排 + 回执；仍不改开关 |
| **W3** | B | week-overview 图文列 + 「批这一周」UI |
| **W4** | B | pm-todo「待批 / 单独拦下」 |
| **W5** | A | #2817 合并后：Reel 批量 promote UX；post-lite 接入另列 |

依赖：**W2 依赖 W1**；UI 可后于编排。**禁止**同一 PR 又改 policy 又改 Meta 又改迁移。

---

## 12. 测试契约（第 2 步，不在本 PR 跑）

对齐现有套件风格：

- 卡指纹 ≠ 当前 Manifest 摘要 → `decide` 拒绝或 void（W2：decide 前重算清单摘要）。  
- agent 身份 → 不能 `decide`（已有 confirmation-card 测试扩展）。  
- 同意后改一条 Story → 扫描 `BLOCKED`；待办出现「单独拦下」。  
- 整包编排一步失败 → **不回滚**已成功步骤（Ray §14.1.6）。  
- `revokeLitePack` 后未发条目不再发送。  
- Story/Reel/计划读失败 → 接口与 Manifest 报「读不到」，**禁止**报 0 条。

---

## 13. Reuse Statement

- **复用**：`story-lite` 预览/授权/撤销/扫描；每日计划 auto-publish 契约与路由；工厂 `runPromote`；`confirmation-card` 全套；`week-overview` 读取；`price-claim-gate` / `outbound-claims` / `content-review`；pm-todo 三件套类型。  
- **平台共享**：Manifest 结构、周指纹算法、编排回执 shape、待办 kind 名称（不含客户名）。  
- **行业 / 客户层**：下周日期窗口、名额、周四/五/一节奏配置。  
- **不碰**：`story-publish/` 搁置栈；真发开关；Meta OAuth；#2817 / #2693 / #3447 分支。  
- **新增共享代码（第 2 步）**：仅「编排器」薄层，参数化 `clientId` / 周次，无客户私有事实硬编码。

---

## 14. 已决定（Ray，2026-11-01 17:34 NZDT）

以下原「待 Ray 定」项已拍板；实现与台账须与此一致。

### 14.1 整包审批与发布

| # | 决定 |
|---|---|
| 1 | **确认卡**：每次打开本周总览现出卡；TTL 仍 30 分钟；专用更长 TTL 不做。 |
| 2 | **第一版整包不含图文帖**；Manifest / UI 标 **not wired yet / 尚未接入**；不调用每日计划 authorize。 |
| 3 | **Reel 批准即公开**：等 **#2817 合并**后再接入整包编排；此前 Reel 只读 + 工厂逐条处理。 |
| 4 | **Reel 批量 UX**：点整包「同意」前，每条 Reel **须已完成 preview**（令牌有效）。 |
| 5 | **CTS 默认节奏**（新西兰时间）：**周四出草稿、周五批、周一起发**；写入客户配置，非全局写死。 |
| 6 | **部分失败**：**不回滚整包**；已成功授权/执行的条目 **继续生效**；失败项单独待办。 |
| 7 | **点同意的人**：维持现状 —— `assertMayClick` 的 **OPC + 负责该客户的 FDE**；Story 线仍要全局管理员，见 §3.2。 |

### 14.2 评论与自动回复（同批 Ray 定，与整包并行、本 PR 不写代码）

| # | 决定 |
|---|---|
| 8 | **问价类评论**：继续 **私信模板 + 公开回复「已私信联系」**；**不在公开回复里给价**。 |
| 9 | **投诉类自动回复**：**保持关闭**。 |

---

## 15. 本步交付与下一步

- 本 PR：`docs/specs/` 本文件 + 台账卡。  
- **未**写代码、迁移、配置。  
- **下一步**：v1 编排与页面在单独的草稿 PR，不推到设计分支。开关默认关闭。Reel 转公开仍等 #2817，并且页面上每条要先预览。图文接入另开 PR。
