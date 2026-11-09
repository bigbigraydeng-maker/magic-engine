# 「只别打电话」和「别再联系」分开 — 第 2 刀设计稿 v0（草稿，A 级，写代码前先过审）

> 来源：PM 2026-11-09 在 76 号窗口定——客人说「不要打电话」≠「不要联系我」，短信/邮件/WhatsApp 照样可以联系。第 1 刀（PR 3692）只加了纯函数 `refusal-scope.ts`，不接线上。本稿是第 2 刀：把新规则接进线上，**解析器切换和电话那一侧的拦截必须一起上线**。
> 风险级别 A（控制外发的核心规则）。派活等级 L4：Claude Code 自写（CLAUDE.md §5 A 级安全核心例外）。

## §0 给 PM 的一页

做完后你会看到：
1. 员工记通话备注写「不要电话」「只邮件联系」，系统记成「只别打电话」，**不再**记成「别再联系」。
2. 这位客人的拨号按钮被拦住，页面提示「这位客人说过不要电话，请用邮件或短信」；今天的名单里他仍在，但「该做什么」从「打给他」变成「回他/发邮件」。
3. 邮件、Messenger、WhatsApp、倒计时信、目录信、Mailchimp 一律不再被拦。
4. 他又被说「别再联系」（退订、说不需要联系）时，仍是全面拦截，比「只别打电话」更重。

这一刀**不改任何存量客人**（Minnie Lillian Kake、gerowlands 仍被拦，直到第 4 刀你看名单说「改」）。更正：Stacey McConnochie 的「别再联系」在 2026-10-16 已被人工纠正（一条 dnc_cleared），她现在不被拦；之前试跑脚本没读清除记录，把她也列了进去，是我的错。

## §1 规则（定稿前请审查员重点看）

| 说法 | 记成 | 拦什么 |
|---|---|---|
| 不要电话、不要打电话、do not like phone call、does not want us to call、只邮件联系 | 只别打电话 | 只拦电话外呼、AI 电话、「打电话」名单 |
| 别再联系、不需要联系、unsubscribe、do not follow up、does not want to talk | 别再联系 | 全部渠道（不变） |
| 同一句两种意思（「只要邮件，不想谈」「不要电话，别再联系」） | 按全面拒绝记（宁可多拦），同时进「请人看一眼」 | 全部渠道 |

原则不变：拿不准，往「多拦」。**只有明确说「电话」的说法才算只别打电话。**

## §2 数据（不新增表、不新增列）

- `CONTACT_OUTCOMES`（`note-parser.ts:25`）加一个值 `do_not_call`。zod、AI schema（`:399`）、`/touchpoints` 白名单（`touchpoints/route.ts:97`）自动跟着认。
- 写入：触点 `channel='phone'`，`metadata.outcome='do_not_call'`，**`metadata.do_not_contact` 不写 true**，**`contacts.do_not_contact` 镜像列不动**。理由：全仓约 30 处把 `flagged` / 镜像列当「全渠道拒联」，写 true 等于把它们全部扩权。
- 真相仍是不可变触点，和 `phoneLineIsDead`（号码是坏的）同一个道理。没有时间戳的镜像列表达不了它。

## §3 判据（`dnc.ts` 加一个函数，别处不重写）

```
isDoNotCall(contactFlag, touches) =
    isDoNotContact(contactFlag, touches)                 // 全面拒绝一定包含电话
 || 最后一次判决是 do_not_call（晚于任何 dnc_cleared）
```

- 清除：沿用现有 `dnc_cleared`（员工在页面「放回名单」）。一条 `dnc_cleared` 同时作废它之前的 `do_not_contact` 和 `do_not_call`，不新增第二种清除。
- `withoutClearedDnc`（`dnc.ts:102`）只筛字符串 `do_not_contact`；新增同族函数让 `do_not_call` 也能被清除后失效，避免「清了还留在分段里」（`dnc.ts` 头注释里那次事故）。

## §4 解析器切换（`note-parser.ts`）

- `DNC_PATTERNS` 里拿掉三条电话说法，改放新的 `DO_NOT_CALL_PATTERNS`。线上词表以 `refusal-scope.ts`（第 1 刀）为准，不复制第二份。
- `classifyNote` 返回 `{outcome:'do_not_call', do_not_contact:false}`；若同时命中全面拒绝 → 仍是 `do_not_contact`。
- 顺序：号码是坏的 > 全面拒绝 > **只别打电话** > 没接通 > …（只别打电话排在「没接通」之前，因为它是客人明确说的）。
- 下游：`messenger-stop-signal.ts:141`、`dnc-reengage.ts:119` 复用 `classifyNote(...).do_not_contact`；切换后 Messenger 里发「不要打电话」不再触发「疑似退订」提示，这是想要的。
- `sheet-followup-sync.ts`、`callback-pick.ts` 消费同一结果，会随解析器一起变；存量不回填（见 §8）。

## §5 电话那一侧必须一起接上（缺一处 = 说过不要电话的人又被打）

| 位置 | 改法 |
|---|---|
| `crm/contacts/[cid]/call/route.ts:65` 拨号接口 | 紧挨现有 DNC 闸再加一道：`isDoNotCall` → 409，文案「这位客人说过不要电话，请用邮件或短信」。`outbound.ts:74` 的拨号函数本身再加一次防守性检查（只有这一个调用方，但别只靠路由）。 |
| `PersonDrawer.tsx:501` 拨号按钮 | 行数据加 `doNotCall`，为真时不渲染 `CallButton`，改显示「只别打电话」小标。 |
| `segments.ts:738-753` 分段 | **复用 `phoneLineIsDead` 的现成做法**：`const reach = (phoneIsDead \|\| doNotCall) && reachKnown ? {...contact, hasPhone:false} : contact`，建议渠道自然落到邮件/Messenger/WhatsApp；`phoneUnusable` 的文案区分「号码不通」和「客人说过不要电话」。 |
| `segments.ts:~790`「电话打不通又没别的路 → 退出名单」 | 同一条判断加上 `doNotCall`，文案写「只别打电话，又没有邮箱和 Messenger」。 |
| `next-action.ts:118-134` `verbOf` | 不用改：建议渠道已不是 phone，会落到 `reply`。 |
| `today/route.ts:281`、`calendar/route.ts:78`、`due-calendar.ts:110` | 构造行数据时多带 `doNotCall`；日历里「回电」类事项对 `doNotCall` 的人跳过。 |
| `callback-pick.ts:156` | `do_not_call` 同样拒绝排回电。 |
| `lead-followup-due.ts:188` | 实现时先读：若它是「该打电话」名单，同样跳过；若是邮件名单，不动（审查员请确认）。 |
| `voice/outbound-gate.ts:58`（AI 电话） | 现在读的是语音库自己的 `do_not_call` 列，**和 CRM 没有联动**（`openai-handler.ts:140` 写死 false）。AI 电话还没上线，本刀不接；在设计里记一条「接 AI 电话前必须接上 `isDoNotCall`」并进台账。 |

**明确不改（必须有测试证明它们不被误拦）**：邮件首发/回复（`mail-send-new-prod.ts`、`manual-send-dnc-gate.ts`、`email/.../reply`）、批量邮件（`touchpoints/batch/route.ts:130`）、Mailchimp 抑制（`suppression-sync.ts:71`）、WhatsApp/Messenger 回复与自动回执、`email-reply-due.ts`、转化回传与广告人群导出。它们继续只看 `isDoNotContact`。

## §6 页面文案与标签

`OUTCOME_LABEL`（`contact-table-types.ts:124`）、`RecentSends.tsx:44`、`weekly-report/build.ts:489`、`ContactTimeline.tsx:174/302` 各加「只别打电话」一行（现在是 `Record<string,string>`，不加不会报错但会显示原始英文）。记备注后的确认提示（`ComposeNote.tsx:86`）区分两种。

## §7 「故意破坏」测试（每条弄坏后测试必须变红）

1. 拨号接口去掉 `isDoNotCall` 闸 → 红。
2. `isDoNotCall` 不包含全面拒绝 → 红（全面拒绝的人能被打电话了）。
3. `isDoNotContact` 把 `do_not_call` 算进去 → 红（邮件被拦了）。
4. `do_not_call` 写入时顺手把 `metadata.do_not_contact` 设 true 或改镜像列 → 红。
5. 分段不把 `doNotCall` 并进 `hasPhone:false` → 红（还在「打电话」名单）。
6. `dnc_cleared` 不作废 `do_not_call` → 红。
7. 同句两种意思不再记全面拒绝 → 红。
8. 邮件发送闸、批量邮件、Mailchimp 抑制、WhatsApp/Messenger 回复各一条「`do_not_call` 的人不被拦」→ 去掉保护即红。
9. 切换前后 `note-parser` 既有 93 条测试：只有那三条电话说法的用例预期改变，其余一条都不能变。

## §8 存量与上线顺序

- 本刀**不改存量**。第 4 刀处理 Minnie Lillian Kake、gerowlands：写一条 `dnc_cleared` + 一条 `do_not_call` 触点（由员工操作留痕，PM 看名单说「改」）。Stacey 已在 10-16 被人工纠正，不用动，但她 07-13 那条原话是「只邮件联系」，第 4 刀可顺手补一条 `do_not_call` 让电话那侧也被拦（PM 定）。
- 历史导入（`sheet_followup`）里的「不要电话」同样不回填，除非第 4 刀的名单里列出。
- 上线顺序：解析器切换 + §5 全部拦截 + 页面 **同一个 PR**，中间不留空档。
- 回滚：整个 PR 一起回滚即可，数据里多出的 `do_not_call` 触点在旧代码里是个不认识的结果值，不会拦也不会放（旧代码里相当于「不是拒绝」）——**所以回滚前要先看有没有新写入的 `do_not_call`，有就要先人工处理**，写进台账。

## §9 藏经阁开工十问（简答）
1. IMPACT 哪一段：Act 的闸（外发约束）。外环指标：被误拦的已订位客人数（现在 ≥1）；被说过不要电话却仍被打电话的次数（目标 0）。
2. 确定的写成代码：全部。没有模型参与。
3. 对外动作：不新增；只是让既有闸更准。需要人批的合并：A 级，PM 说「合 N」。
4. 完成证据：测试 + 当场试跑 + 上线后只读核对一次生产。
5. 谁验证：子牙、魏征两位审查员（Opus），不是写的人。
6. 学到什么：无。
7. 考卷：第 1 刀试跑的 17 条真实原话 + 新增的跨渠道用例。
8. PM 纠正落到哪：纠正 = 改词表（`refusal-scope.ts` 单一来源）。
9. 读不到怎么办：判不出就按「全面拒绝」处理，不放行。
10. 占 PM 注意力：一次「合」。

## §10 待审查员回答
- `lead-followup-due.ts:188` 是电话名单还是邮件名单？
- `voice/crm-bridge.ts:188` 把「AI 电话里客人说不感兴趣」写成全渠道 `do_not_contact`，是否有意？（不在本刀范围，只请确认。）
- `segments.ts:1~40` 的 `TouchpointLike` 是否需要新字段，还是现有 `outcome` 足够？
