# DeepSeek 任务单：自动安抚消息限频（同一位客人 N 小时内只自动安抚一次）

**状态：已写好，未派发。** 等 PM 对两处业务口径回一句话再派（见「待 PM 拍板」）。
**写入者**：派发后为一个 Claude Code 会话（76 号）跑 aider/DeepSeek；本单只覆盖下列文件。
**风险级**：**A**（对客外发的发送逻辑变更）。PR 必须保持草稿、正文写「风险级别：A」，等 PM 本人回「合 N」。
**起因**：PR 2958 审查时发现——`conversation-inbound-autoack` 只有「同一会话 30 秒合并」，客人隔几分钟再发一条会再收一遍同样的安抚话；CTS 的 WhatsApp 开关已开，线上已是这个行为。

## 待 PM 拍板（派发前必须有一句话）
1. **N 取几小时？** 默认写 **6**。
2. **「员工或 AI 草稿已经回复过，就不再自动安抚」要不要？** 默认写 **要**。

回法示例：`6 小时，要` 或 `12 小时，不要`。

## 范围（尽量小）
只改：
- `src/lib/inngest/functions/conversation-inbound-autoack.ts`：在 `check-channel-enabled` 之后、`classify-conversation` 之前加一步 `check-recent-outbound`；`ConversationInboundAutoAckDeps` 增加一个依赖 `hasRecentOutbound(conversationId, since, opts)`；新增终态 `skipped_recently_replied`（加进 `AutoAckOutcome`）。
- 同文件旁（或 `src/lib/messenger/` 下一个小文件）实现 `hasRecentOutbound`：读 `conversation_outbound_log`（`send.ts` 每次出站都会写一行：`conversation_id / sent_by_email / body / status / created_at`），**不新增表、不新增列**。
- 窗口 N 的读取：常量 `AUTOACK_COOLDOWN_HOURS = 6`（PM 定后改数）；**不做 per-client 配置**，要客户级差异另开卡。
- 测试：`src/lib/inngest/functions/__tests__/conversation-inbound-autoack.test.ts`。

不改：`autoack-identity.ts` 的模板与发件身份、`channel-dispatch`、F2 草稿流程、30 秒 debounce（保留）、任何 UI。

## 判据（口径）
在最近 N 小时内，该会话 `conversation_outbound_log` 里有 `status` 为成功的出站记录，则跳过安抚：
- 命中「自动安抚本身」（`sent_by_email = AUTOACK_SENT_BY_EMAIL` 且 body 等于 `AUTOACK_TEMPLATE`）→ 一律跳过（核心限频）。注意该发件身份也被 F2 批准草稿共用，**必须同时比对 body**（见 `autoack-identity.ts` 头注释）。
- 命中其它出站（员工手写、人工批准的 AI 草稿）→ 仅当 PM 回「要」时跳过。
- 失败/pending 的出站行不算已回复（发送失败不应让客人永久收不到安抚）。
- 读取出错 → **fail-closed 偏安静**：throw 让 Inngest 重试，不放行也不吞（与 `check-opt-out` 同口径）；不要把读失败当「没回过」而多发。

## 必须覆盖的五个测试情形（每条断言「被跳过的步骤压根没被调用」，不只看返回值）
1. 首次（窗口内无任何出站）→ 发，`send` 调用 1 次。
2. 30 秒内连发 → 仍由既有 debounce 合并（保留既有装配断言：`debounce.period === '30s'`、key 为 conversation_id）。
3. N 小时内再发（上次是自动安抚）→ `skipped_recently_replied`，`send` 0 次。
4. 超过 N 小时再发 → 发，`send` 1 次（用注入时间/`since` 参数断言边界，N 与 N+ε）。
5. 员工回过（`sent_by_email` 为员工邮箱，body 非模板）→ 按 PM 口径：「要」→ 跳过；「不要」→ 发。**两种口径各一条测试，另一条作为变异对照。**
附加：失败出站不算已回复；读取报错 → 抛错而非放行；模板被改（body 不等于 `AUTOACK_TEMPLATE`）的自动安抚身份不被误认。

## 验证与当场试跑
- `npx vitest run src/lib/inngest/functions/__tests__/conversation-inbound-autoack.test.ts`，再 `npx tsc --noEmit`（只看触及文件）、`npx eslint` 触及文件。
- 变异：去掉新步骤 → 情形 3 必须红；把 N 改成 0 → 情形 3 必须红。
- 当场试跑（只读 + 不外发）：用 Inngest 本地/注入依赖触发函数，`send` 用假实现；再对生产库只读查一次 CTS 近 7 天 WhatsApp 会话里「同一会话 N 小时内出现 ≥2 条自动安抚」的条数，作为改前基线（改前 N 条会被限掉，写进 PR 正文）。**不得真发消息。**

## 评审
A 级：子牙 + 魏征 + （对客外发）板桥；重点让魏征攻击「员工回过」口径、失败出站、模板比对三处。

## 平台化说明
限频逻辑对所有走 F1 的渠道与客户通用；N 为平台默认常量，客户差异走配置属后续卡。无客户名/行业语义写入共享代码。
