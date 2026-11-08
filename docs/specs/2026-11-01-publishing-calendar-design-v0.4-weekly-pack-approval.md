# 发布日历设计稿 v0.4 补充：每周整包确认卡（Story + 图文 + Reel）

- **日期**：2026-11-01（新西兰）｜ **风险级**：A（合并三条发布线的授权，最终会决定对外发什么）
- **状态**：只出方案。没有代码、没有建表、没有改任何发布开关。
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
| 图文 | 每日计划自动发：**契约**在 `daily-plan-auto-publish*.ts`，路由 `campaign-daily-plan/auto-publish/authorize`；**近乎 0 真发、默认演练**。并列「Post 最小版」仅设计稿，**未建表** | [`2026-10-14-post-lite-design.md`](./2026-10-14-post-lite-design.md) |
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
| `posts` | 可选：每日计划维度（`plan_id`、`plan_revision`、覆盖日期、每帖指纹）或 post-lite 包（未来）；**第一版常为空** |
| `reels` | 工单列表（`work_order_id`、建议发布日、`promote` 用内容指纹、当前 `video_state`） |
| `assembled_at` | 组装时间（**不进**内容指纹，与确认卡惯例一致） |

**清单来源（只读，与 week-overview 对齐并扩展）**：

- Story：与 week-overview 相同规则——优先已授权且在有效期内的包，否则最新草稿包。
- Reel：与 week-overview 相同工厂查询；只纳入「审查已过、仍草稿、落在下周窗口内」的条目（具体过滤在第 2 步 PR 写死，本稿要求：**没读到的行必须报「读不到」**）。
- 图文：第一版 Manifest **可以只有占位**（`connected: false`），或挂接已有 `social_plans` 只读行（不授权）。

---

## 3. 确认卡：一个入口，三条线各走各的授权

### 3.1 出卡（issue）

触发时机见 §8「待 Ray 定」；实现上两种候选：**打开本周总览页时**调用 `issueConfirmationCard`，或 cron 在「该批了」时出卡并待办提醒。

**卡事实（`CardFacts`）建议**：

| 字段 | 示例内容 |
|---|---|
| `subjectKey` | `social:week-pack:<clientId>:<weekStart>`（仅小写/数字/`:_-`，符合现有校验） |
| `what` | 「同意按清单发布下周 Story / 图文 / Reel；改过的条目会单独拦下。」 |
| `date` | 「2026-11-03 至 2026-11-09（新西兰）」 |
| `scope` | 分项计数与状态：Story 18 条、Reel 3 条、图文 0 条（尚未接入） |
| `account` | 客户显示名（无生产编号） |
| `amount` | 「无额外广告花费」或「不涉及预算」 |
| `hardChecks` | 汇总只读检查结果（绿/红/读不到），例如「Story 包级可授权」「Reel 3 条已过画面审查」「图文线路演练中」 |

**指纹（回答设计问题 §3.2）**：

1. 对 Manifest 中**每一条**取稳定元组：`(kind, stable_id, per_item_fingerprint, scheduled_at_iso)`。  
   - Story：`stable_id = item_id`，指纹用 story-lite 已有条目指纹 / 包内映射。  
   - 图文：`stable_id = plan_id + date`（或 post-lite 的 `item_id`），指纹用各线已有哈希字段。  
   - Reel：`stable_id = work_order_id`，指纹用 `runPromote` 上下文已有 fingerprint。  
2. 按 `(scheduled_at_iso, kind, stable_id)` **排序**后，组成数组。  
3. `content_fingerprint = canonicalHashOfInput({ subjectKey, week_start, entries })`（与确认卡 [`contentFingerprint`](../../src/lib/confirmation-card/facts.ts) 同一套 canonical hash）。  
4. **后加条目**：不在排序数组里 → 整卡指纹变 → 旧 pending 卡被 `voidStaleCard` 作废，需重新出卡。**PM 点同意时仍要比对一次**，与 Story `PACK_CHANGED_SINCE_PREVIEW` 同精神。

卡的 `content_fingerprint` 字段存上述哈希；**各线自己的包哈希 / promote 指纹不改**。

### 3.2 点「同意」（decide → 编排，不改各线内核）

仅在 `decideConfirmationCard` 成功且 `decision === confirmed` 之后，由**新的编排服务**（第 2 步 PR）顺序调用，**每步 fail-closed**，并写机器可读回执（client id、subjectKey、runId、每线结果码）：

| 线 | 现成函数 / 路由逻辑 | 整包同意时做什么 |
|---|---|---|
| Story | `buildLitePreview` → `authorizeLitePack({ confirm: true, expectedContentHash: preview.content_hash })` | 与 Story 预览页相同；失败则整卡 settle 为「部分失败」并待办（**不**静默跳过） |
| 图文 | 每日计划：`CampaignDailyAutoPublishAuthorizeCommand` 校验 + 写授权记录（与 `auto-publish/authorize` 相同） | **仅当 Manifest 含可授权计划且 Ray 选定线路后**调用；否则回执 `skipped_not_connected` |
| Reel | 每条 `runPromote(deps, { confirm: true, previewToken, ... })` | 见 §3.3 |

**身份**：整卡 `decide` 仍走 `assertMayClick`（OPC / 负责该客户的 FDE）。**agent 永远不能代点**（与 v0.3 §4 一致）。编排层不得用 service role「代 PM 补点」各线授权。

**部分成功策略（实现细节，第 2 步 PR 定）**：建议「Story 失败则不再授权 Reel」；Reel 逐条失败则已成功的保持，失败项进待办——**是否允许「半包生效」待 Ray 定**（见 §9）。

### 3.3 Reel：整包一点 vs 逐条 previewToken

`runPromote` **今天**要求：每条先 `previewStage` 拿 `preview_token`（5 分钟 TTL），再 `confirm: true`。

整包编排**不能**跳过 preview（代码会 403）。第 2 步实现选项（均复用 `runPromote`，不新写 Meta 调用）：

- **A**：点「同意」前，页面已为清单内每条 Reel 跑过预览（令牌未过期）；编排层按清单顺序带 token 确认。  
- **B**：编排层在 PM 点同意时**同步**对每条先 preview 再 confirm（仅当 PM 会话仍有效且 5 分钟内完成）。  

卡面 `hardChecks` 应标明 Reel 是否「已预览可确认」。**「批准即公开」是否纳入第一版整包**见 §9（与 #2817 顺序相关）。

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

周包从打开页面到读完清单 often > 30 分钟。可选方向（**均属审批规则变更 → §9 待 Ray 定**）：

1. **沿用 30 分钟**：页面加载时 `issue`；快过期时前端提示「请重新打开页面出卡」。  
2. **打开页时现出卡**：每次进入总览刷新 pending 卡（指纹不变则复用）。  
3. **周包专用 TTL**：新 `action_key` 或 policy 字段 —— **要改表 / policy，第 2 步单开 A 级 PR，本步不做**。

设计建议写进 §9，不在本稿拍板。

---

## 7. 图文落差（回答设计问题 §3.5）

| 选项 | 含义 | 整包卡表现 |
|---|---|---|
| **先演练 / 尚未接入** | Manifest 不挂可授权图文；scope 写「图文：尚未接入（每日计划仍演练 / Post 最小版未上线）」 | 点同意**只办 Story +（若启用）Reel** |
| **先 Post 最小版** | 依赖 post-lite 建表与扫描器 —— **大范围 A 级**，先于整包或并行 | Manifest 挂 post 包哈希，走姊妹于 story-lite 的 authorize |

v0.3 长期仍可用「候选 → 日历」统一图文；**整包 v1 不依赖候选表**。

---

## 8. Reel 与 #2817（回答设计问题 §3.6）

**背景**：开放 PR #2817 拟修正「草稿仍被记成已发布」类问题；未合并前，promote 成功后的展示/台账可能与主页不一致。

**设计顺序（不在本稿定死）**：

1. 若 Ray 要求「批过即公开」进整包：编排层在 #2817 合并并通过回归前，应用 **`dry_run` / 只授权不 promote** 开关包裹 Reel 步骤，或整包卡 hardCheck 标红「Reel 公开暂不可用」。  
2. 若 Ray 接受「整包先只授权 Story，Reel 仍在工厂逐条点」：Reel 在 Manifest 中只读展示，**不**进指纹或进指纹但 `skipped_manual_promote`。

详见 §9。

---

## 9. 发布节奏（回答设计问题 §3.7）

**提议**（社媒手册 v1.1 / Facebook playbook v0.2）：周四出草稿、周五批、下周一～日按计划发。

**实现**：写入客户配置（例如 `publishing_calendar` / client profile 扩展字段），**不写死 cron**。出卡待办只读配置算「批包窗口」；真正的发送时刻仍由各线 slot（Story 08:30/13:00/20:00 等）决定。

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
| **W5** | A | 若 Ray 选定：policy TTL / post-lite 接入 / Reel 批量 promote UX |

依赖：**W2 依赖 W1**；UI 可后于编排。**禁止**同一 PR 又改 policy 又改 Meta 又改迁移。

---

## 12. 测试契约（第 2 步，不在本 PR 跑）

对齐现有套件风格：

- 卡指纹 ≠ 当前 Manifest → `decide` 拒绝或 void。  
- agent 身份 → 不能 `decide`（已有 confirmation-card 测试扩展）。  
- 同意后改一条 Story → 扫描 `BLOCKED`；待办出现「单独拦下」。  
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

## 14. 待 Ray 定（Open questions）

以下**本稿不拍板**；括号内为**建议默认**，供 Ray 勾选或改口。

1. **整包确认卡有效期**  
   - 选项：沿用 30 分钟 / 每次打开总览现出卡（仍 30 分钟滚动）/ 周包专用更长 TTL（要改 policy）。  
   - **建议**：先 **「每次打开总览现出卡 + 仍 30 分钟」**，不改 policy；周包专用 TTL 单独开 A 级 PR 再定。

2. **第一版整包里的图文**  
   - 选项：Manifest 标注「尚未接入」，同意只办 Story（+Reel 若启用）/ 必须先 Post 最小版上线再开整包。  
   - **建议**：**先尚未接入**；Post 最小版建表 PR 与 W2 解耦。

3. **Reel「批准即公开」是否进第一版整包**  
   - 选项：进（编排层批量 preview+confirm）/ 不进（整包只 Story+图文）/ 进但等 #2817 合并后再开 promote 步骤。  
   - **建议**：**等 #2817 合并后再开 promote**；之前卡上 Reel 只读展示，hardCheck 写「公开仍要在工厂逐条确认」。

4. **Reel 批量确认 UX**  
   - 选项：点同意前必须每条已预览 / 同意时编排器自动连跑 preview+confirm。  
   - **建议**：**点同意前每条已预览**（A），避免 5 分钟 TTL 中途过期半包。

5. **周四出稿、周五批、周一发**  
   - 选项：采纳为默认客户配置 / 改节奏 / 暂不配置只人工批。  
   - **建议**：**写入客户配置为默认提议值**，Cron 待办按配置提醒，不强制自动出卡。

6. **整包同意部分失败**  
   - 选项：任一线失败则全部回滚 / 允许部分线成功。  
   - **建议**：**Story 失败则不动 Reel**；Reel 逐条失败不影响 Story 已授权（与「线独立」一致），待办列明细。

7. **谁可以点同意**  
   - 现状：OPC + 负责该客户的 FDE（`assertMayClick`）。  
   - 选项：维持 / 仅 Ray 账号 / 扩到客户员工。  
   - **建议**：**维持现状**；若 Ray 要「仅本人」，走 kernel 角色变更 A 级 PR，不在 W2 偷偷改。

---

## 15. 本步交付范围

- 仅 `docs/specs/` 本文件（+ 可选台账卡）。  
- **未**写代码、迁移、配置；**未**跑应用 build。  
- 第 2 步等 Ray 看过 §14 后再派（L4，草稿 PR，Ray 亲手合）。
