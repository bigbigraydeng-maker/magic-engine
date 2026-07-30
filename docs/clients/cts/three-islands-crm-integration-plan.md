# CTS 三孤岛接入 ME 统一 CRM — 分阶段方案

> 客户：CTS Tours NZ（`c0000000-0000-0000-0000-000000000000`）
> 日期：2026-07-28 · 作者：子牙（已过魏征架构审 + 板桥业务审）
> 状态：**方案，未写任何代码、未动任何 migration、未发任何请求。** 这是 ME 后端开发立项，不是 CTS 运营操作。
> 配套：先看 [`newsletter-execution-plan.md`](./newsletter-execution-plan.md)（上个窗口的整体诊断）。本文只管「把三个孤岛接进 ME 后端」这一块。

---

## 一页看懂

ME 后台 7/26 已建好统一 CRM（PR #658–#661）：一张「人」表（335 个 CTS 真人已入库，9 人已标别再联系）+ 身份合并 + 触点表 + 「今天该联系谁」页 + 冷热分级。**地基不重建。** 缺的是把另外三个数据源接进来：

| 孤岛 | 现状 | 接进来能拿到什么 | 价值 |
|---|---|---|---|
| **info@ 邮箱** | ME 里 0 条邮件触点 | **谁回了信、谁被报价、谁付定金、谁成交** —— 有些成交客户走官网/邮件，根本不在 FB 表里 | 🥇 最高（唯一的成交证据） |
| **Mailchimp** | ME 里 0 行、无代码、无密钥 | 322 订阅者跟 335 人合并去重；退订/别再联系两边同步 | 🥈 中 |
| **Messenger** | 同步任务已注册但 0 行数据 | AI 在聊的人、热信号，跟 FB lead 合并成一条记录 | 🥉 最低（也最轻） |

**唯一架构原则（从代码事实推出，不可绕过）**：ME 的「今天联系谁」页 + 冷热分级
**只读 `contact_touchpoints` + `contacts.do_not_contact`**（`src/app/api/clients/[id]/crm/today/route.ts` 已核实：不读 `conversations`）。
所以每个孤岛接入 = **必做两件事，缺一即对系统隐形**：
1. 调 `resolveContact()` 建人 / 合并身份（`src/lib/crm/identity.ts`，认 email / phone / fb_psid）
2. 写一条 `contact_touchpoints`（幂等 by `client_id + source + source_ref`）

---

## 复用什么（不重建，已核实存在于 `main`）

| 复用 | 文件 | 作用 |
|---|---|---|
| 合并引擎 | `src/lib/crm/identity.ts` | `resolveContact()` / `buildIdentities()`，认 email/phone/fb_psid，靠唯一约束幂等，多命中时选最早 contact 迁移身份 |
| 备注→结构化 | `src/lib/crm/note-parser.ts` | `parseNote()`（AI）/ `classifyNote()`（规则）→ outcome / travel_window / tour_interest / competitor / callback |
| 冷热分级 | `src/lib/crm/segments.ts` | 纯函数 6 段，**只从触点 + do_not_contact 算** |
| 回填模板 | `scripts/import-cts-fb-leads.ts` | resolveContact + 触点 upsert，幂等 by source/source_ref |
| 富化脚本 | `scripts/enrich-touchpoint-notes.ts` | `parseNote` 回填 metadata，幂等（跳过 `enriched=true`） |
| Messenger 同步 | `src/lib/messenger/sync.ts` + cron `messenger-sync-hourly` | 已写 conversations/messages，**但不调 resolveContact、不写触点、不设 contact_id** |
| 通用对话表 | `conversations`（由 messenger_* 改名） | 已有 channel(messenger/email/voice/whatsapp)、contact_id、subject、status(open/won/lost/not_a_lead)、owner_email、snooze_until |

`contact_touchpoints.channel` 的 CHECK 已允许 `email` 和 `messenger` 两个值 —— **接 info@ 和 Messenger 都不用改数据库。**

---

## 跨孤岛必做清单（魏征补 · 三岛都适用 · 违反即埋雷）

1. **拒联跨渠道落到人身上**：任一孤岛检测到「stop emailing / 别再联系」→ 必须写 `contacts.do_not_contact`。写到 `conversations.status` 或触点 metadata 是**读不到的合规漏**（读模型只读触点 + do_not_contact）。
2. **成交也要落到人身上**：`conversations.status` 改 won/lost **必须同步写一条触点**。否则 today 页看不到 → 已成交客户继续进培育邮件。这是 conversations 层和触点层的双源真相风险，靠这条纪律消除，**换取零 migration**。
3. **每条触点必带 `source_ref`**：Postgres 把 NULL 视作互不相等，漏填 → 重跑无限重复。Mailchimp 事件**绝不能用时间戳当 ref**，要合成确定性键（如 `mc:{campaign_id}:{member_id}:{event_type}`）。
4. **护栏 · 一等公民（板桥）**：**只有真实双向触点才升级成「客户」。** 订阅这个动作、陌生发件人，**不凭空造客户身份**；认不到已知线索的先进「待归类」暂存区，**绝不直接进「今天联系谁」**。335 人干净表不能被弄脏 —— 这个项目最大的翻车方式不是「接不进来」，是「把干净表弄脏」。
5. **合并要迁移 conversations（魏征）**：`resolveContact` 合并时只迁 identities + touchpoints，**不碰 conversations.contact_id**。任何设 conversations.contact_id 的代码必须自己处理 re-merge，否则留悬挂对话。

---

## Phase 0 — 共用地基 + Messenger 试跑

> **主角是地基，不是 Messenger。** Messenger 只是拿最便宜的渠道先把「合并→触点」管道跑通一遍 —— 宁可炸在 Messenger，也别炸在装着「谁付了钱」的 info@ 上。对 PM 不把「先接了 Messenger」当成果汇报（板桥）。

- 抽共享 `recordTouchpoint()`（从 import 脚本的 upsert 逻辑抽出），三个孤岛共用一个写入口。
- Messenger sync 增补三件 + 三个硬防护：
  - 增补：resolveContact + 写 `channel='messenger'` 触点 + 回填 `conversations.contact_id`。
  - **防护 A（魏征）**：正文自由文本正则抽出的电话/邮箱，**不直接喂不可逆合并**（`resolveContact` 多命中是不可逆迁移）—— 高置信度才合，否则只记身份、不自动并。
  - **防护 B（魏征）**：合并迁移时**同步迁移 conversations.contact_id**，别留悬挂对话。
  - **防护 C（魏征）**：**per-thread try/catch continue**。现在整个循环共用一个 try（`sync.ts:139-153`），塞进会抛的 resolveContact 后，一个坏 thread 会放弃该客户剩下所有 thread。
- 「永不发送 / 永不当客户」名单：内部域名（`@ctstours.co.nz`）+ 坏地址。板桥：扩成不只挡发送，也挡误建客户。
- deal-stage 纯函数骨架（为 Phase 1 备）。
- **闸：先诊断 `conversations=0` 根因。** cron 已注册（`render.yaml:640`，每小时跑），所以不是没注册。根因大概率二选一：① `META_SYSTEM_USER_TOKEN` 缺（正是焦点表标 🔴 待 PM 的那条）② `CRON_SECRET` 没 link env group（`render.yaml:72` sync:false，每天静默 401）。
  → **所以 Phase 0 不是「0 PM」**。诚实讲法：代码我先写，让 Messenger 真出数**可能撞到一个要 PM 配的 token**，我查清楚再单独说。
- **无 migration。**

---

## Phase 1 — info@ 邮件（最高价值：报价/定金/成交证据）

- **PM 第一个、也最值钱的请求 —— info@ 后台自动读授权。**
  委托权限已有（bdm@ 对 info@ 有 Full Access，server 端 admin consent 含 Mail.Read.Shared），**但那是交互式 M365 MCP，ME 后台 cron 用不了**（生产 cron 无交互式 OAuth）。生产自动读需要 ME 自己的 Graph 应用授权（在 CTS 租户里注册一次，PM=bdm@ 是管理员）。
  ⚠️ 修正 newsletter-plan 里「info@ 不需要 PM 操作」的说法 —— **需要，一次性。**
- 建 Graph 连接器读 info@ → 每封邮件 touchpoint `channel='email'`（已允许）+ 每 thread conversation `channel='email'` + `resolveContact` by email 跟 FB lead 合并。
- **噪音护栏（板桥）**：供应商 / no-reply / 系统 / 员工发件人 → 待归类，不建客户。子牙先填域名短名单，PM 只确认「这些不是客户」。
- 扩 note-parser 出 deal-stage（inquiry / quoted / deposit / paid / won）存触点 metadata。
  - won → 路由到 referral 段（`segments.ts` 扩，**不打 do_not_contact** —— 成交 ≠ 别再联系）。
  - won 同步写触点（跨岛必做清单 #2）。
- deal-stage 用纯函数算（照 `segments.ts` 聚合 outcomes 的范式），**不加手填列 → 无 migration**。
- **空窗期兜底（板桥）**：Phase 1 上线前，已知成交/已付客户先让**运营窗口手动**从促销摘掉，不等自动修。子牙把已知名单（CRM Sheet 阶段轴那批）递过去。这是此刻唯一正在伤客户关系的事，别拖。

---

## Phase 2 — Mailchimp（322 人合并去重）

- **PM 第二个请求 —— Mailchimp API key**（含 server prefix `us19`）。**串行，办完 info@ 再问**（板桥：一次一件事，两个 credential 一起抛 PM 会办一个忘一个）。先 grep 现有 env 命名再定 key 名（memory：APIFY 造过平行命名的坑）。
- 建 mailchimp 连接器读 322 成员 + 订阅状态 + 退订。`resolveContact` by email 合并；**新订阅者不凭空当客户**（护栏 #4）—— 订阅状态存身份层，不造触点、不进今天联系谁。
- **opens/clicks 不写触点**（魏征）：`segmentContact` **不读 channel**，把打开写成 inbound 触点会被误判成「客户回信了」最高优先段；且 Apple 隐私会自动打开所有邮件，本就不可信。只存订阅状态 + 退订。
- **退订 → 写 `contacts.do_not_contact`**（邮件维度），直接落到人，不靠段推断。
- **撤销原「加 `email_marketing` enum」的计划**：魏征证伪 —— segments 全程不读 channel，加这个 enum 修不了任何问题，白烧一次 PM migration 配额。**预计 Phase 2 也无 migration**；万一真发现要改数据库，停下来单独问 PM。
- **双写边界（板桥）**：ME 后端 = `do_not_contact` **唯一真相源**；运营窗口 = 发送 campaign 开关 + 空窗期手动兜底。子牙**动 Mailchimp 任何写入前先跟运营窗口对齐**（CLAUDE.md「同文件被另一代理修改先停」，Mailchimp 就是共享文件），不双写。反向同步（ME dnc → Mailchimp 排除组）上线后运营侧停手动、交棒。

---

## Phase 3 — 度量 + 交棒

- 把这条链做成 ME 能读的数：**进线 → 联系上 → 回信 → 报价 → 付定金 → 成交**。现在中间三格系统完全是黑的，Phase 1 填上。北极星 = **email 可追溯的成交数**（现在 0 可追溯，2 单是口头）。
- 暴露 ME 分段作为运营窗口 Mailchimp Journey 的驱动源（trigger 由运营窗口接）。

---

## PM 一共点几次（串行）

| # | 请求 | 卡住 | 时机 |
|---|---|---|---|
| 1 | info@ 后台自动读授权（Graph 应用，一次性） | Phase 1 全部 | 最先、最值钱 |
| 2 | Mailchimp API key | Phase 2 全部 | 办完 #1 再问 |
| 3 | （可能）一个 Meta token / CRON_SECRET，让 Messenger 出数 | Phase 0 出数 | Phase 0 诊断时才知道要不要 |

**预计不需要任何数据库改动。** 万一某一步发现要改，停下来单独问 —— 不夹带。

---

## 顺手发现的运营待查（魏征 · 另开小任务，不混进本方案）

初始回填 `import-cts-fb-leads.ts` 用的是 `classifyNote`（纯规则），metadata 里没有 travel_window / callback_at → `segments.ts` 的 `callback_due` 和 `nurture_future` 两段对已导入的 335 人**不触发**。
**修的代码已存在**：`scripts/enrich-touchpoint-notes.ts` 用 `parseNote` 富化 metadata、幂等。
→ 待查的是**这个脚本有没有对 prod 的 335 人跑过**。是运营/诊断动作，不是新代码。

---

## 明确不做

- ❌ 不重建联系人系统（335 人在跑）。
- ❌ 不做运营侧发送（暂停/恢复发送、Mailchimp 后台操作）—— 那是另一个窗口。本任务只管 ME 后端接入。
- ❌ 不把 opens/clicks 当触点（会毒化冷热分级）。
- ❌ 不让订阅者/陌生发件人凭空变成「客户」进今天联系谁。
- ❌ 不在没跟运营窗口对齐前写 Mailchimp。
- ❌ 不夹带 migration —— 预计一次都不用，要用先单独问。
