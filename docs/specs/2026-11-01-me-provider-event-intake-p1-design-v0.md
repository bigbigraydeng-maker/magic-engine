# ME 发信底座 P1 实现设计 — 只接 Resend 回调、只存证据（v1.1，2026-11-01，设计一轮 + 实现一轮审查均已吸收）

> **风险级别：A**（新公共入口 + 新表 + 写生产库 + 验签密钥）。**本稿是实现设计，与代码同在一个改动单里；代码已按 §10 的两轮审查意见改过。**
> **等级 / 模型（PM 2026-11-01 规则）**：L4（A 级新做）。方案 = 本窗口（Sonnet 5.5；我没有擅自切换窗口模型，那是 PM 的设置）+ 子牙 / 魏征（Opus 子代理）审；代码 = DeepSeek（aider）分轮写；实现审 = 子牙 / 魏征（Opus 子代理）。
> **来源**：[发信设计稿 v0.4](./2026-10-29-me-email-sms-sending-design-v0.md) §4.7 / §5 P1；PM 2026-11-01 回「开始」。
> **本稿就是 P1 的唯一任务说明**（CLAUDE.md「一份任务说明」），不另写第二份。审查处理见 §10。

## 0. 任务说明

| 项 | 内容 |
|---|---|
| 目标 | ME 能收到 Resend 的送达回执（已发 / 已送达 / 延迟 / 退信 / 投诉 / 失败 / 被抑制），验过签后存下；同一事件重放不重复；伪造被拒。**不发信、不改任何联系人、不做任何后续动作。** |
| 验收 | §7：本机真数据库 + 真 PostgREST 试跑、单元 / 路由测试、变异探针、仓库自带的迁移重放与安全不变量检查、类型检查 / 构建无新增错误；上线后核验另有台账卡（需 PM 先完成 §6）。 |
| 完成即停 | 开出**草稿**改动单（A 级，附本机试跑结果）后停；PM **亲手合并**并回「go apply」。 |
| 写入者 | 本窗口（唯一）；代码经 aider 由 DeepSeek 分轮写入（含审查后的测试增补），本窗口审 diff 后提交；审后的小改动（长度常量、日志级别、`v1,` 过滤、路由早判、个别测试断言）由本窗口手改，改动单正文有清单。其余参与者只读。允许改的文件见 §3.1。 |
| 权限 | 本地读写 + 本机一次性数据库 / PostgREST。**不碰生产库、不应用迁移、不合并、不部署、不开账号、不配密钥、不读 Resend 页面上的密钥。** 提交 / 推送功能分支 / 开草稿改动单：PM 回「开始」已授权（推送攒到最后一次推）。 |
| 基线 | 仓库 `…/worktrees/relaxed-tereshkova-9d7bf8`，分支 `feat/me-provider-event-intake-p1`，HEAD = `54748e7e4` = origin/main（2026-11-01 13:42 NZDT 刷新），工作区干净。类型检查改动前基线：`tsc --noEmit` 退出码 2，7 条既有错误，全在别的模块的测试里（`ads-strategy` / `ads-tracking-preflight`）。 |

## 1. 范围（对照 ENGINEERING_QUALITY_GATES §4）

**做（最小契约）**：①一张新表 `provider_webhook_events`（A 级迁移）；②一个公共入口 `POST /api/webhooks/resend/[account]`（P1 只认 `system`）；③验签（复用仓库已有工具）；④白名单事件按供应商事件号幂等入库（去掉主题、清洗不可存字符）；⑤测试、文档（`docs/ENV.md`、`.env.example`）、台账卡。

**与总设计 §5 P1 一行的差别（共六处，逐条列出，评审时按它核）**：
1. **只建一张表**（回调原始事件表），「触发型发送状态表」推迟到 P2：P1 没有任何读者，字段要等 P2 的发送关口设计定了才写对，提前建就是「以后可能用」（Gates §4-2）；P2 本来就要另开 A 级迁移，PM 亲手合的次数不因此增加。
2. **不发 Inngest 事件**（理由、替代回执、恢复条件见 §3.7）。
3. **不要求「客户发信独立 Resend 账号」，也不留 `client` 标签**：总设计原话是「先只收 ME 现有系统邮件的真实事件」，P1 只接这一个账号；独立账号是 P2 的前提，到时同一个 PR 加标签、变量和用例。
4. **出口标准改成可对账的**：N 封内部邮件 × Resend 后台显示的事件数 = 表里的行数（见 §7），而不是「回调全部入库」。
5. **事件白名单去掉 `email.opened` / `email.clicked`**：总设计 §4.7 对它们只要计数，P1 没有读者；点击事件还带收件人 IP 和浏览器信息，没有读者就不该存。
6. **「验签失败拒收并计数」只用结构化日志**：总设计 §4.7 写了这一条；P1 不另建计数表或事件（Gates §4-2），靠日志代号（`signature_mismatch`、`secret_unavailable` 记 error 级）+ 核验卡 T+7 + P2 每日对账兜底（§3.6）。

**明确不做**：
- 不发信、不写 Resend 适配器、不碰 `src/lib/email/sender.ts`；
- 不更新联系人（硬退信标无效、投诉标别再联系都是 P2）；
- 不接 Resend 收信（`email.received` 含邮件正文，白名单外一律不存）；
- 不做保留期清理任务、不做短信、不做退订入口、不改 126 / 127 / 129 的代码与卡；
- 不动 `middleware.ts`（matcher 只管 `/dashboard` `/portal` `/prospect`，`/api/webhooks/*` 本来就不过登录门）。

## 2. 现状与复用（建前三处核对：代码、在飞改动单、台账）

- **代码（origin/main，2026-11-01）**：没有任何 Resend 回调入口（grep `svix` / `webhooks/resend` / `email.delivered` 无命中）。**复用**：①`src/lib/voice/providers/webhook-sign.ts` 的 `verifyWebhookSignature`（Standard Webhooks 算法：`id.timestamp.body` → HMAC-SHA256 → base64；OpenAI 语音回调在用；已用 Svix 官方文档示例向量验算一致）；②`src/lib/telephony/voipline/ingest.ts` 的 `readCappedBody`（256 KiB 上限）；③`@/lib/supabase` 的 `supabaseAdmin`；④Twilio / 电话接收壳「壳薄、逻辑在 lib、store 可注入」的写法与 `insert + 23505 当重复`的先例（`src/lib/crm/email-templates/receipt-store.ts`）；⑤127 号迁移（`20261028130000_crm_email_templates.sql`）的触发器 + service-role RLS 模板。**没有任何测试或 eslint 规则拦 `messaging` 引用 `voice` / `telephony`**（`kernel/__tests__/architecture.test.ts` 只管 kernel、bridge、growth 三个目录）。仓库另有 `src/lib/http/bounded-body.ts`（`readBoundedJson`），但它读完直接 `JSON.parse` 返回解析值，而验签需要原始字符串，所以不能用；`readCappedBody` 是借自电话模块的通用小工具，后续可下沉到 `src/lib/http/`（另开，不在 P1）。
- **Resend 官方库**：`resend@6.12.4` 依赖官方 `standardwebhooks`，自带 `resend.webhooks.verify`。**P1 生产验签不直接用它**（要先构造带密钥的客户端，失败只抛通用错误，拿不到日志要的原因代号），但**测试里把它当独立对照**（§7）。
- **在飞改动单**：#3412 / #3334（127 号，设计稿，草稿）不碰回调、不建同名表；#3412 的擦除做法（管理员手动事务）本稿沿用。无冲突。
- **台账**：无同类卡（`docs/ledger` 里 resend / webhook / bounce 无命中）。

## 3. 设计

### 3.1 文件清单（只许动这些）

| 文件 | 说明 |
|---|---|
| `supabase/migrations/20261101150000_provider_webhook_events.sql` | 新表 + 触发器 + RLS（§3.2） |
| `src/lib/messaging/provider-events/types.ts` | 类型、账号与事件白名单常量、`ProviderEventStore` 接口 |
| `src/lib/messaging/provider-events/resend-signature.ts` | 读密钥（严格校验）+ 把 `svix-*` 头映射到已有验签工具 |
| `src/lib/messaging/provider-events/resend-ingest.ts` | 纯处理函数 `handleResendWebhook`（含清洗、预校验；不依赖 Next / Supabase，便于测试） |
| `src/lib/messaging/provider-events/store.ts` | `supabaseProviderEventStore`（唯一碰数据库的文件） |
| `src/app/api/webhooks/resend/[account]/route.ts` | 薄壳：限长读体 → 调处理函数 → 回 JSON |
| `src/lib/messaging/provider-events/__tests__/*.test.ts`、`src/app/api/webhooks/resend/[account]/__tests__/route.test.ts` | 单元 + 路由 + 迁移结构测试 |
| `docs/ENV.md`、`.env.example` | 各加一个变量行 |
| `docs/ledger/2026-11-01-*.md` | 台账卡（§6、§7） |

### 3.2 表 `public.provider_webhook_events`（A 级迁移，PM 亲手合 + 回「go apply」）

```sql
create table public.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{1,30}$'),          -- 'resend'；以后短信供应商同表，不用改表
  account text not null check (account ~ '^[a-z][a-z0-9_]{1,30}$'),            -- 供应商账号标签：P1 只有 'system'（不是客户名）
  provider_event_id text not null check (char_length(provider_event_id) between 1 and 200),   -- svix-id：重试时不变
  event_type text not null check (char_length(event_type) between 1 and 80),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),  -- data.email_id
  occurred_at timestamptz,                                                       -- 载荷顶层 created_at
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),             -- 已去掉 data.subject；已清洗 NUL / 孤立代理字符
  received_at timestamptz not null default now(),
  constraint provider_webhook_events_event_key unique (provider, account, provider_event_id)
);
```
- **不可改写、不可删除**：`BEFORE UPDATE OR DELETE`（行级）和 `BEFORE TRUNCATE`（语句级）触发器无条件 `raise exception`（service_role 能绕过 RLS，所以不能只靠「代码不改」）。函数用本表专属名字 `provider_webhook_events_append_only()`，**不借用** 127 的 `crm_email_append_only`；并对 `public, anon, authenticated` 收回执行权限（仓库先例）。写法照抄 127 号迁移 118–137 行的形状。
- **擦除与保留期**：和 127 的 #3412 同一做法——**不建角色、不建函数、不开接口**，由库的所有者在控制台手动执行一段事务（对本表 `DISABLE TRIGGER` → 按条件 `DELETE` → 核对删除行数 → `ENABLE TRIGGER`，全在一个事务里，记台账）。**保留期建议 180 天**（覆盖 27 小时重试窗口 + 对账 + 排查）；自动清理任务属 P2 的 A 级 PR，台账另有一张卡跟踪（§7），不是只写在文字里。
- **RLS**：`enable row level security` + `for all to service_role using (true) with check (true)`（必须带 `TO service_role`）+ `revoke all … from anon, authenticated`。**不写 `notify pgrst`**（新表不需要，340 个迁移里只有 4 个用）。
- **不加外键、不加 `client_id`**：本表按供应商账号记事件，不按租户隔离。⚠️ 但**不是「没有租户数据」**：系统账号还发客户线索通知（主题含客人姓名）、冷外联、门户邀请，所以载荷里有客户员工 / 客人的邮箱和客户名（§3.6）。P2 通过 `provider_message_id` 与带租户的状态表关联。不加额外索引（P1 没有读者）。
- 唯一约束是**普通唯一约束**。⚠️ P2 若用 `upsert`，**只能用 `ignoreDuplicates`**（重复回 201 加空数组）；合并模式遇重复会撞 `BEFORE UPDATE` 触发器，报 `23001` 而不是 `23505`。

### 3.3 接口契约：`POST /api/webhooks/resend/[account]`

`account` P1 只认 `system`（代码常量，对应 ME 现有的系统邮件账号）。密钥环境变量 `RESEND_WEBHOOK_SECRET_SYSTEM`（格式 `whsec_…`）。

| 情况 | 状态码 | 响应体 | 日志（一行 JSON，永不含载荷 / 头 / 密钥） |
|---|---|---|---|
| `account` 不在白名单 | 404 | `{"ok":false,"error":"not_found"}` | 无 |
| 密钥没配 / 空 / 格式不对 | 503 | `{"ok":false,"error":"unavailable"}` | **error**：`secret_unavailable`（密钥被删 / 配坏时所有真事件都会被拒，和签名不符一样要醒目） |
| 体超 256 KiB | 413 | `{"ok":false,"error":"too_large"}` | 无 |
| 缺头 / 时间戳坏 / 超 ±300 秒 | 401（同一个响应体） | `{"ok":false,"error":"invalid_signature"}` | warn：`missing_headers` / `bad_timestamp` / `outside_window` |
| 头齐全但签名不符（含：头里没有任何 `v1,` 开头的项） | 401（同上） | 同上 | **error**：`signature_mismatch`（最像「密钥配错 / 刚轮换」或被攻击，要醒目） |
| 签名对，但 JSON 坏 / 不是对象 / 缺 `type` / `svix-id` 形状不合规 | 400 | `{"ok":false,"error":"bad_payload"}` | warn：`bad_payload` |
| 签名对，事件类型不在白名单 | 200 | `{"ok":true,"ignored":true}` | info：`ignored_type` + 类型名 |
| 新事件，已入库 | 200 | `{"ok":true}` | 无（量大） |
| 重复（同 provider + account + svix-id） | 200 | `{"ok":true,"duplicate":true}` | 无 |
| 入库抛错（库不通等） | 500 | `{"ok":false,"error":"store_failed"}` | error：`store_failed` + **仅错误码**（`error.code`，≤16 个字母数字下划线，否则记 `unknown`） |

- 只导出 `POST`（其它方法 Next 自动 405）；`export const dynamic = 'force-dynamic'`。未知账号在**读请求体之前**就回 404（路由和处理函数各判一次）。
- **500 / 503 不吞**：Resend 按「立刻、5 秒、5 分钟、30 分钟、2 小时、5 小时、10 小时、10 小时」共 8 次重试（约 27.5 小时，官方页面 2026-11-01 取）。
- **不用「按错误类别一律当可忽略」兜底**：那会让我们自己的 bug（例如字段长度对不上）被 200 悄悄吞掉，Resend 后台一片绿、ME 一行没存。已知会让入库永远失败的输入（超长、空串、NUL、孤立代理）在入库前清洗 / 预校验掉（§3.5），剩下的未知错误保持 500，让它响。

**事件白名单**（官方页面 + SDK 类型）：`email.sent`、`email.delivered`、`email.delivery_delayed`、`email.bounced`、`email.complained`、`email.failed`、`email.suppressed`（共 7 个）。其余（`email.opened` / `email.clicked`、`email.scheduled`、含邮件正文的 `email.received`、联系人 / 域名事件）一律 200 忽略、不入库。PM 在 Resend 后台建回调时也只勾这 7 个。

### 3.4 验签（复用，不另写密码学代码）

`resend-signature.ts` 把 `svix-id` / `svix-timestamp` / `svix-signature` 映射成已有工具要的 `webhook-id` / `webhook-timestamp` / `webhook-signature`，调 `verifyWebhookSignature(rawBody, headers, secret, 300, nowSec)`。算法与 Svix 官方文档一致：签名内容 `${id}.${timestamp}.${原始请求体}`，密钥取 `whsec_` 之后的 base64 解码，HMAC-SHA256，输出 base64，头里 `v1,<签名>` 可空格分隔多个，常量时间比较。已用 **Svix 官方文档示例向量**（`msg_p5jXN8AQM9LWM0D4loKWxJek` / `1614265330` / `{"test": 2432232314}` / `g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=`）验算一致，魏征另用 `readCappedBody` 的分块读法对含中文 + emoji 的载荷在每个字节处切块验过 0 次失败。
- **必须用原始请求体字符串**（`readCappedBody` 的返回值），不得先 `JSON.parse` 再 `stringify`。
- **密钥严格校验**（`loadResendWebhookSecret`）：先 `trim`（粘贴进 Render 常带换行）；必须以 `whsec_` 开头，其后**只含标准 base64 字母表**（`A-Za-z0-9+/`，末尾可有 `=`），解码后 ≥ 16 字节，否则当「没配」（503）。原因：已有工具遇到空密钥会用零长度密钥算 HMAC（**空密钥 = 任何人都能伪造**：官方库对空字符串会抛 `Secret can't be empty`，但对只有前缀的 `whsec_` 同样用零长度密钥算 HMAC、放行空密钥伪造的签名——本窗口与魏征都实测过）；Node 的 base64 解码很宽松，`whsec_` 加 30 个 `-` 也能解出 22 字节，所以不能只数字节。
- **只认 `v1,` 开头的签名项**：官方库要求 `v1,` 前缀，而已有验签工具会把不带前缀的裸签名也拿去比对；`resend-signature.ts` 先过滤，头里一个 `v1,` 项都没有就当签名不符（子牙实现审发现；有测试与官方库对照）。
- 时间容差 300 秒（Svix 标准库默认）。Svix 文档写明重试时 `svix-id` 不变、时间戳按每次尝试重新给（魏征读文档所得；Resend 页面没写，上线核验时实测，§7）。

### 3.5 入库、清洗与幂等

- 去重键 = `(provider, account, provider_event_id)`；`provider_event_id` = `svix-id` 头（已被签名覆盖；校验形状 `^[A-Za-z0-9_-]{1,200}$`）。**同一封信的不同事件（sent / delivered）svix-id 不同，各存一行**。
- **入库前预校验，保证不会撞 CHECK**：`provider_message_id` = `data.email_id`，**按清洗之后的值**判断，仅当是 1–200 字符的字符串才取，否则 `null`（**不拒收**）；`occurred_at` 在 JS 里解析顶层 `created_at`，失败、或年份不在 2000–2100 内都记 `null`（不交给 Postgres 解析；越界 / 负数年份会让 Postgres 解析失败，变成永远重试的毒事件）；`event_type` 来自白名单。三个长度上限放在 `types.ts` 的常量里，测试逐个比对迁移里的 CHECK，防两边悄悄漂移。
- **清洗**：对解析后的整个对象递归处理（键和值）：删除 `\u0000`（Postgres jsonb 不收，报 22P05）、把孤立代理字符换成 U+FFFD（PostgREST 报 PGRST102）；**去掉 `data.subject`**（自由文本，常含客人姓名）。清洗在 try/catch 里，出错按 `bad_payload` 400。
- 写入用普通 `insert`，Postgres 报 `23505`（唯一冲突）当「重复」回 200；其它错误抛出 → 500。魏征用与 supabase-js 同版本的 postgrest-js 对真 PostgREST 实测：重复回 HTTP 409 且 `error.code === '23505'`（字符串），20 个同号并发只存 1 行。
- `payload` = 清洗后的整个对象。

### 3.6 日志与隐私（如实表述）

- 日志一行一个 JSON（`evt:"provider_webhook"` + 结果代号 + account），**永远不打载荷、请求体、请求头、密钥，也不打 `error.message` / `details`**——魏征实测 CHECK 违例时 PostgREST 的 `details` 是 `Failing row contains (…完整行…)`，会把邮箱带进日志。`store.ts` 抛出的 Error 只带错误码；有一条测试专门断言「失败日志里不含 `@`」。
- **载荷里有什么**：系统账号（`RESEND_API_KEY`）不只发系统邮件，还发①客户网站线索通知（发件名含客户名、收件人是客户员工、主题含客人姓名；`api/clients/[id]/leads/route.ts`）②冷外联邮件③门户邀请④网站体检报告信（收件人是公开访客）。所以 `to`（收件人邮箱）和 `from`（含客户名）会进表；`subject` 在入库前删掉；点击 / 打开事件不收。表只有 service_role 能读写。
- **保留期 180 天**（§3.2），清理任务属 P2；客户下线时按 `payload->'data'->'to'` / `from` 找行，走 §3.2 的擦除事务。
- **静默窗口（如实说）**：单条事件在约 27.6 小时后永久失败；Resend 页面没写「持续失败多久停用」，魏征读到的 Svix 文档是「全部失败满 5 天才停」，停用后连 401 日志也没有。因此「密钥换了没同步 → 真事件被拒」可能静默数天。护栏：①头齐全但签名不符记 **error 级固定代号** `signature_mismatch`；②上线核验卡加 T+7 一项：Resend 后台 Failed = 0 且表里有行；③P2 的每日对账（供应商实发 vs ME 记录）兜底。

### 3.7 为什么 P1 暂时不上 Inngest（CLAUDE.md §3「暂时不上」条款：写明原因、恢复条件、替代回执）

- **原因**：P1 只有「验签 → 一次数据库写入」，没有跨步骤异步接力，也没有外部副作用，现在发事件没有任何人订阅，只会多一份没人验证的事件契约。
- **替代回执**：`provider_webhook_events` 的每一行就是机器可读回执（供应商事件号、类型、消息号、时间、清洗后的载荷）。
- **恢复条件 = P2**：状态更新函数上线的同一个 PR 加业务事件 `crm.provider_event.received`（命名沿用发信设计稿 §4.13）。⚠️ **不能只对「新入库」的行发**：本表不可改，没有「已处理」标记，发事件失败后 Resend 的重试只会命中重复，事件就永远丢了。P2 必须在**遇到重复时也补发 / 补处理**（消费者按事件号幂等），或另做补处理任务（电话回调 `voipline/ingest.ts` 头注释的「先落库、发事件失败只吞、补处理兜底」是先例）。

## 4. 威胁模型（A 级必备）

| # | 威胁 | 防线 | 由哪条测试 / 探针证明 |
|---|---|---|---|
| T1 | 伪造事件（没有密钥的人 POST） | 验签，失败 401，且**不碰数据库** | 伪造 / 改体 / 换密钥 / 缺头用例；探针「验签永远通过」必须变红 |
| T2 | 重放截获的请求 | 时间戳 ±300 秒（过去和未来**两侧**都查）+ 事件号唯一 | 过期 / 未来时间戳用例（真实时钟）；探针「去掉时间窗」「只查一侧」变红 |
| T3 | 大体积 / 慢速攻击 | `readCappedBody` 256 KiB，超限 413 | 路由用例 |
| T4 | 密钥配错（空 / 缺 / 格式坏 / 非法字母表） | 严格校验，一律 503（fail-closed） | 空串 / 空白 / 只有前缀 / 太短 / `whsec_` 加 30 个 `-` 用例；探针「去掉空密钥闸」变红 |
| T5 | 注入 / 超长字段 / 毒事件（NUL、孤立代理、空串 email_id） | 参数化插入；入库前清洗和预校验；表上 CHECK 兜底 | 毒事件用例 + 本机真库 CHECK 用例 |
| T6 | 误存含正文或个人行为信息的事件 | 事件类型白名单（`email.received`、`opened`、`clicked` 不在内）；删主题 | 白名单外用例；探针「去掉白名单」变红 |
| T7 | 隐私泄露（日志 / 匿名读取） | 日志不含载荷也不含 DB 错误详情；RLS 仅 service_role | 「失败日志不含 `@`」用例 + 本机库 `SET ROLE anon` 被拒 |
| T8 | 时序侧信道 | 已有工具用 `timingSafeEqual` | 复用，不另测算法 |
| T9 | 记录被改写 / 删除 | 触发器禁 UPDATE / DELETE / TRUNCATE；对 service_role 同样生效（魏征实测：service_role 停不了触发器、改不了 replication_role） | 本机真库试跑 + SQL 变异「删掉触发器」必须变红 |
| T10 | 表属主 / 持 service_role 密钥者 | **接受的风险**：库所有者本来就能停触发器（擦除事务靠它）；持 service_role 密钥者能直写伪造行；service_role 仍持有表级 TRIGGER / UPDATE / DELETE / TRUNCATE 权限（魏征实测），但 REST 接口跑不了 DDL，能跑 DDL 的连接本来就是所有者级信任——和库里所有其它表同一信任边界，也和 127 迁移同形（不额外 revoke），不在 P1 防 | — |
| T11 | 擦除后点 Resend 的 Replay | **接受**：被擦的行会作为新行重新入库（魏征实测 201）；擦除步骤（§3.2；随保留期清理任务落成 SOP）注明「先在 Resend 后台确认该事件不会再被 Replay」 | — |

## 5. 并发与失败模型

- 同一事件号并发到达：唯一约束串行化，一个入库一个 23505 → 都回 200。
- 重试风暴：每次都是同一事件号，只入库一行。
- 库不通：500，Resend 重试（§3.3）；**不**在内存里缓冲（Render 实例重启会丢）。
- 部分失败：只有一次 `insert`，没有「写一半」；入库成功后回 200 之前进程崩溃 → Resend 重试 → 命中重复，回 200。
- 密钥轮换：Resend 轮换后可能同时带新旧两个签名（头里多个 `v1,`），已有工具逐个试；轮换时先在 Render 更新变量并手动部署，再在 Resend 确认旧密钥到期。
- 回滚：在 Resend 后台停用 / 删除该回调（一条设置）；路由留着无害（没密钥就是 503）；表留着；真要删表另开 A 级迁移。

## 6. 上线顺序与要人做的事（what / how / href）

迁移是人工应用的（仓库里没有自动跑迁移的流水线），**代码合并 ≠ 库已升级**。碰迁移的 PR 会被合并闸标 `needs-ray-merge`：**必须 PM 亲手合，agent 不得用 `--admin`**（`.github/merge-authorization.md`）。

| # | 谁 | 什么 | 怎么做 |
|---|---|---|---|
| 1 | PM 回「go apply」，我执行 | 在生产库建表 | 我用 Supabase 工具应用迁移，再用 `to_regclass` / 约束查询回读（不按文件名查账本）。应用的 SQL 必须与改动单头提交里的迁移文件逐字一致（先比哈希），审查签字后不得再改这个文件。**我不会自己动手，等 PM 这句话。** |
| 2 | **PM 亲手合并** | A 级 + 碰迁移 | 草稿转正式、检查全绿后，PM 在 GitHub 上合；我不合、不加 `--admin`。 |
| 3 | PM 授权，我用浏览器做 | 在 Resend 后台为**现有系统邮件账号**建回调，**建完立刻停用** | Resend → Webhooks → Add Endpoint；URL `https://app.magicengine.com.au/api/webhooks/resend/system`；只勾 §3.3 的 7 个事件；建好马上点停用（密钥到手前不让真事件打进来吃 503）。这是改第三方账号设置，**要 PM 明确点头；这一次点头请一并覆盖我后面要做的三件事**：①第 5 步启用回调；②核验时在 Resend 后台对一条事件点 Replay；③核验时向 hello@ 发 N 封内部测试信（只发内部地址，不发给任何客人）。**我不读页面上的密钥那一块。** |
| 4 | **只能 PM 本人**（密钥不进聊天、我也不能代填） | 把回调的 Signing secret 填进 Render | Render → `crazycontent` → Environment → 新增 `RESEND_WEBHOOK_SECRET_SYSTEM` → 保存 → **手动 Deploy**（改变量不会自动重新部署），并回读「部署时间晚于改变量时间」。 |
| 5 | 我（已含在第 3 步的授权里） | 启用回调并核验 | 在 Resend 后台把回调改回启用；核验见 §7 生产部分。 |

「客户发信独立 Resend 账号」（设计稿 §7-3）是 P2 的前提，**不在 P1 的路径上**。

## 7. 验证计划

**本机（开草稿改动单前必须全部做完并留证）**
1. **仓库自带的迁移重放 + 安全不变量**：用 `scripts/db-replay-and-verify.sh` 对本机一次性 Postgres 17 从零重放全部迁移（含新迁移）再跑 `scripts/db-invariants.sql`，并跑 `node scripts/check-policy-to-clause.mjs`——这是 CI「DB security invariants」同款检查，先在本机过一遍。
2. **真数据库行为试跑**（沙盘里 `service_role` / `anon` / `authenticated` 都按 Supabase 默认授权设好，否则 anon 被拒可能只是「本来就没授权」）：重复事件号报 23505；UPDATE / DELETE / TRUNCATE 被触发器拒（`23001`）；`SET ROLE anon` / `authenticated` 读写被拒（`42501`）；`service_role` 可读写；各 CHECK 拒绝坏值。再加**两条 SQL 变异**：删掉 `REVOKE`、删掉触发器，对应用例必须变红。
3. **真 PostgREST 端到端试跑（一次性脚本，不提交）**：本机有 PostgREST 16.3，起一个对着沙盘库的实例；用**真的 `store.ts` + 真的 supabase-js**（环境变量指向本机 PostgREST，用 `service_role` JWT）调 `handleResendWebhook`；签名用**独立于被测代码**的 `crypto` 实现生成；发 3 条合法事件 + 1 条重放 + 1 条伪造 + 1 条过期 + 1 条白名单外 + 1 条坏 JSON + 1 条毒事件（含 `\u0000` 和空 `email_id`），断言库里恰好 3 + 1 行（毒事件被清洗后入库）、`subject` 不在库里，并记下每次返回码。审查后又补了 7 个场景：孤立低位 / 串尾高位代理、含 NUL 的 `email_id` 与键名、200 / 201 字符的 `svix-id`、4000 层嵌套数组（回 400、不碰库），全部符合预期，没有一个回 500。
4. **单元 / 路由测试（vitest，文件头 `// @vitest-environment node`）**：§3.3 表逐行一条，另加：①**独立对照**——同一批用例同时喂我们的验签和 `resend.webhooks.verify`（官方库），两边结论必须一致；②**固定向量**——Svix 官方文档示例向量 + 本窗口用 node 与 openssl 两种方式算出的含中文 / emoji 向量；③原始体带 `\uXXXX` 转义和多余空白（抓「先 parse 再 stringify」）；④同一 `email_id`、不同 svix-id 存 2 行；⑤非 23505 的库错必须 500；⑥时间窗**两侧**（过去和未来）；⑦毒事件（NUL、孤立代理、空串 / 超长 `email_id`、不可解析 `created_at`）；⑧失败日志不含 `@`；⑨密钥严格校验（含 `whsec_` + `-`×30）；⑩签名头里没有 `v1,` 项（裸签名 / 只有 v2 / 纯空白）与官方库对照；⑪日志卫生（每次调用的日志只含允许的键，不含 `@` / 密钥）；⑫迁移 CHECK 长度与 `types.ts` 常量逐个比对；⑬触发器函数体精确等于「无条件 raise exception」。时间窗：真实时钟的用例用 ±290 秒（接受）/ ±310 秒（拒绝），留 10 秒余量，不拨假时钟；精确边界 ±300 / ±301 秒用注入的 `nowSec` 做确定性测试。
5. **变异探针**（A 级只对关键判据；冻结 head 上一次）：①验签永远返回通过；②去掉时间窗；③时间窗只查一侧；④去掉空密钥闸；⑤去掉事件白名单；⑥23505 不再当重复；⑦401 分支改成继续入库；⑧账号白名单放开；⑨日志里带上 `error.message`；⑩不删 `subject`；审查后又加了：孤立低位 / 串尾高位代理分支、`svix-id` 长度放宽、路由先 parse 再 stringify、`email_id` 用未清洗的值、503 日志带出密钥值、两条 CHECK 改窄、触发器函数先 return、`v1,` 过滤放宽、常量与 SQL 漂移、时间窗多放 1 秒等，共 35 个。每个都必须让至少一条测试变红，且区分「断言失败」与「崩溃」。
6. `tsc --noEmit`（带 `NODE_OPTIONS=--max-old-space-size=10240`，核对退出码与非 `.next` 错误数）对比基线（退出码 2、7 条既有错误）；改动文件 eslint（worktree 里要用带 `root: true` 的临时配置）；`npm run build`（带 CI 同款三个占位环境变量）。

**当场试跑（CLAUDE.md §5 要求，PR 正文写「## 当场试跑」）**：本机第 1–3 项就是试跑。**生产上的完整链路现在跑不了**——它依赖 §6 的 1–4 步（库里没表、Resend 没建回调、没有密钥），这些都是 PM 才能放行的事。因此另开一张核验卡（owner agent），内容：①对生产地址发一个伪造签名的 POST → 必须 401 且库里没新行；②**N 封内部邮件 × Resend 后台显示的事件数 = 表里的行数**（先发几封，再数）；③在 Resend 后台对一条事件点 Replay → 库里仍是一行；④若上线以来任何一次投递曾失败并被重试（503 / 500），记下重试是否被接受（验证 §3.4 的假设）；没有失败就写「未观察到」（回调按 §6 建完先停用，不会专门制造失败）；⑤**T+7**：Resend 后台 Failed = 0 且表里有行。②发内部邮件、③点 Replay 都已在 §6-3 一并授权。

## 8. 未核实 / 开放项

1. Resend 对回调响应的超时时间、哪些状态码算成功：官方页面没写，按「2xx 成功」假设。
2. Resend 重试是否用新时间戳重新签名、Replay 是否沿用原 `svix-id`：Svix 文档说是（魏征读到），Resend 页面没写；上线核验第 ③④ 项实测。若 Replay 换了事件号，会入库一条内容相同的行——原始表是流水，P2 的消费者按（消息号、类型、时间）幂等处理，不靠这张表去重。
3. 事件载荷各字段：只核了 `delivered` 与 `bounced` 两份官方示例（顶层 `type` / `created_at` / `data`，`data.email_id` / `to` / `subject` / `bounce`）；其它类型按同一外壳处理，不依赖具体字段（除 `data.email_id`）。
4. ME 现有 Resend 账号的档位 / 允许的回调个数：未核（设计稿 §11-A-8）；PM 在 Resend 后台建回调时会看到。
5. 「持续失败多久停用」：见 §3.6，Resend 页面没写。
6. 体积放大：JSON 数字经 supabase-js 序列化后可能膨胀（魏征实测 262,036 字节的请求体发给 PostgREST 变成 1,152,811 字节）；Supabase 网关的体积上限没核。Resend 事件实际只有几 KB，上线核验时留意有无 413 / 超限。
7. 试跑没经过真的 `next start`（路由在 Node 运行时、构建标记 `ƒ` 已核）；本机 PostgREST + 自写转发器与真 Supabase 网关的差别（max-rows、db-pre-request、HTTP/2、超时）未逐项核。

## 9. Reuse Statement（预填，交付时对账）

- **复用**：`voice/providers/webhook-sign.ts` 验签、`readCappedBody`、`supabaseAdmin`、电话回调壳与 `insert + 23505` 先例、127 号迁移的触发器 + RLS 写法、#3412 的擦除做法、`scripts/db-replay-and-verify.sh`、设计稿 §4.7 / §4.13 的口径；测试里用 Resend 官方库当对照。
- **新增 platform-shared**：`provider_webhook_events` 表（`provider` / `account` 是通用列，以后短信供应商同表）。`messaging/provider-events/` 里的类型与入口目前是 **Resend 专用**（`types.ts` 写死 `'resend'`），短信供应商到时加自己的适配器和类型，不挤进这套。
- **复用工具的位置**：验签借自 `voice/providers`、读体借自 `telephony/voipline`，都是通用小工具；后续可下沉到 `src/lib/http/`（另开，不在 P1）。
- **industry-specific**：无。**client-specific**：无（`account` 是供应商账号标签，不是客户；没有客户名 / 客户 ID / 行业判断进共享代码）。
- **换客户 / 换行业测试**：CTS → NAL → 悉尼地产客户，这段代码都不用改（事件来自 ME 自己的 Resend 账号）。
- **学习**：无；退信 / 投诉信号怎么用是 P2 的事，只留客户私有层。
- **落点与 tier-gate 决策时是否一致**：一致（L3 Connector 入站适配器 + 共享入库口，无新能力线）。

## 10. 审查记录（设计一轮：子牙、魏征；2026-11-01；两位都判「需改后再审」，无 P0）

两位独立只读。魏征另用真 PostgREST 16.3 + 与 supabase-js 同版本的 postgrest-js 实测了 23505 判重、触发器、权限、并发（脚本在本会话 scratchpad）。以下是发现与处理：

| # | 级别 | 发现（谁） | 处理 |
|---|---|---|---|
| 1 | P1 | 漏了官方验签：`resend` 自带 `webhooks.verify`（依赖 `standardwebhooks`），§8-4「没有官方库」不对（子牙 + 魏征） | **采纳**：核实属实。生产沿用仓库已有工具（要先构造带密钥的客户端、失败只抛通用错误，拿不到日志代号；两者同一算法），**测试里把官方库当独立对照** + Svix 官方向量；§8-4 已删 |
| 2 | P1 | 自造本机库桩会假绿（不设默认授权时 anon 被拒证明不了 REVOKE 起作用） | **采纳**：改用仓库脚本做全量重放 + 不变量；行为试跑补 service_role 默认授权；加两条 SQL 变异（§7-1、7-2） |
| 3 | P1 | 「P1 没有租户数据」不成立：系统账号发线索通知（主题含客人姓名）、冷外联、门户邀请；点击事件带 IP / UA（子牙 + 魏征） | **采纳**：核实属实（`leads/route.ts:295-313`）。更正 §3.2 / §3.6 / §9；去掉 opened / clicked；入库前删 `subject`；定保留期 180 天（清理任务 P2，台账卡跟踪）；写明客户下线怎么找行 |
| 4 | P1 | 放行 DELETE 与总设计「只增」、127 迁移、#3412 不一致；P1 没有删除者（子牙） | **采纳**：行级触发器改 `UPDATE OR DELETE`；擦除走管理员手动事务（#3412 同款） |
| 5 | P1 | §6「PM 回合 N 我才合」违反合并规矩：碰迁移的 PR 留给 Ray 亲手合，agent 不得 `--admin`（子牙） | **采纳**：核实属实（`merge-authorization.md:63、87`）。§0、§6 已改 |
| 6 | P1 | 偏离总设计 §5 P1 的不止一张表；Inngest 不属于例外；「只对新入库行发事件」会丢事件；出口标准降级（子牙） | **采纳**：§1 列全五处差别；§3.7 改按「暂时不上」条款写；P2 遇重复也必须补处理；出口改「封数 × 事件数 = 行数」 |
| 7 | P1 | 日志会把载荷带出去：CHECK 违例时 PostgREST 的 `details` 含完整行；`email_id` 空串 / 超长、`\u0000`、孤立代理会让入库永远 500（魏征） | **采纳**：只记 `error.code`；入库前清洗 + 预校验；加「失败日志不含 `@`」用例。**不采纳**「按错误类别当可忽略」的兜底（会吞掉我们自己的 bug，§3.3） |
| 8 | P1 | 测试会一起坏一起绿：试跑用 psql store，真 `store.ts` 没对真 PostgREST 跑过；自己造签名自己验；缺用例（魏征） | **采纳**：§7-3 用真 PostgREST + 真 supabase-js + 真 `store.ts` 试跑；§7-4 加独立对照、固定向量和 9 类用例 |
| 9 | P1 | 静默窗口没说实：单条 27.6 小时后永久失败；Svix 全败满 5 天才停且之后无日志（魏征） | **采纳**：§3.6 如实写；`signature_mismatch` 记 error 级；核验卡加 T+7 |
| 10 | P2 | `client` 标签 / 变量 / 威胁 T9 在 P1 没有调用方（子牙） | **采纳**：拿掉，P2 加（§1-3） |
| 11 | P2 | 给 P2 的 upsert 留路只在 `ignoreDuplicates` 时成立；合并模式撞触发器报 23001（子牙 + 魏征） | **采纳**：§3.2 写明；P1 用 `insert + 23505` |
| 12 | P2 | 回调建好到密钥填好之间每次投递都是 503；页面会显示密钥（子牙） | **采纳**：§6 改成「建完立刻停用 → 填密钥并部署 → 再启用」；agent 不读密钥那一块 |
| 13 | P2 | 补函数 `revoke`；`notify pgrst` 不是惯例（子牙） | **采纳**：已改（§3.2） |
| 14 | P2 | 密钥闸要用严格 base64 字母表；Node 解码宽松（魏征） | **采纳**：§3.4、T4 |
| 15 | P2 | 威胁模型漏写三点：表属主可停触发器、持 service_role 者可直写伪造行、擦除后 Replay 会重新入库（魏征） | **采纳**：T10、T11；T9 补「对 service_role 同样生效」 |

**两位都说「改完只复核改动处」**。复核并入实现审查（代码写完后，子牙 + 魏征同时看本稿与代码），不另开一轮纯文档审查。

### 实现一轮（子牙、魏征；2026-11-01；被审提交 80608849d；两位都无 P0，子牙判「需改后再审」、魏征判「可开草稿改动单，补测试缺口」）

| # | 级别 | 发现（谁） | 处理 |
|---|---|---|---|
| 16 | P1 | 授权缺口：启用回调、核验时发内部信、点 Replay 被写成 agent 自己做（子牙） | **采纳**：§6-3 的 PM 点头一次覆盖这三件；§6-5、核验卡同步 |
| 17 | P1 | A 级证据无处可核：重放 / 不变量 / SQL 变异 / 变异探针 / tsc / build 都不在提交里（子牙） | **采纳**：改动单正文逐条贴命令、退出码和时间；没跑的写没跑 |
| 18 | P1 | 测试盲点：三条清洗断言永远不会失败（`JSON.stringify` 把 NUL / 孤立代理转成 ASCII 转义）；低位代理分支无覆盖；不带 `v1,` 前缀的签名我方收、官方库拒（子牙 + 魏征） | **采纳**：改成递归检查对象里的字符串和键；补低位 / 串尾高位 / 含 NUL 的 `email_id` / 清洗后长度 / 含 NUL 的 `subject` 键；`resend-signature.ts` 只认 `v1,` 项并加对照用例 |
| 19 | P1 | 17 个新变异存活 13 个，其中两条在真 PostgREST 上回 500（魏征） | **采纳**：补用例 + 日志卫生 + 常量漂移 + 路由原始体保真 + 精确函数体；35 个探针全部杀死；端到端补 7 个场景全不回 500 |
| 20 | P2 | 设计稿与事实不符（6 处）（子牙） | **采纳**，逐处已改。其中「官方库对 `whsec_` 也放行」经本窗口实测：对 `''` 抛错、对 `whsec_` 放行空密钥伪造——原句改精确 |
| 21 | P2 | +301 秒用例跨秒会误红（子牙） | **采纳**：真实时钟用 ±290 / ±310；精确边界用注入的 `nowSec` |
| 22 | P2 | 迁移结构测试截取函数体截在 `append_only` 里（子牙）；触发器只有本机脚本证明（魏征） | **采纳 / 部分采纳**：改为精确匹配函数体（任何多余语句，比如先 return，CI 里就会红）；真库行为证明留在本机脚本和改动单正文，不并入 CI 的重放检查（范围外） |
| 23 | P2 | 复用说明不全；路由先读体后判账号（子牙） | **采纳**：§2、§9 补写；路由里先判账号 |
| 24 | P2 | ENV.md 图例；日历提醒；先建表后合并必须用合并版文件（子牙） | **采纳**：`.env.example` 加行、ENV.md 标 ✅；3 条日历提醒已建（11-09、11-16、12-15）；§6-1 加哈希一致 |
| 25 | P2 | `secret_unavailable` 只记 warn（魏征） | **采纳**：改 error |
| 26 | P2 | service_role 仍持有 TRIGGER 等表权限（魏征） | **接受**：写入 T10，与 127 迁移同形 |
| 27 | P2 | JSON 序列化膨胀；试跑没经过真 `next start`（魏征） | **记入** §8-6、§8-7 |
| 28 | P2 | `mutate.py` 把 M18 误记存活、M05 没应用（魏征） | **采纳**：修了分类器和目标文本，35 个探针全部杀死 |

实现一轮之后不再开第三轮（Gates §5：第三轮仅限新增的安全 / 数据完整性风险）；PM 合并前如有新提交，需对新头重审。
