# Self-Serve Readiness 测试计划 — 3 PR 验收 SOP

> **适用范围**：验收已 merge 进 `main` 的三个 PR（MTC wiring + tiered auth + FeatureLockGate + 并发/退款加固）。
> **目标**：PM 看完就能照着跑，能让 FDE 也照着跑。每个 case 通过 = 该功能在 prod 真实生效。
> **环境**：全部针对 **prod**（`https://magicengine.com.au` + Supabase 项目 CrazyContent）。**无 staging**。
> **维护人**：狄仁杰（起草）→ PM / FDE / 工程师分工执行
> **最后更新**：2026-06-05

---

## 0 · 这是在验什么（3 PR 速览）

| PR | commit | 核心变更 | 用户能感知的事 |
|----|--------|---------|--------------|
| **#370** | `1e5d085` | MTC 扣费接到所有生成端点 + 三档 tier auth + 张骞限流持久化 + 签注幂等 | 生图/生视频/博客/社媒/张骞 discover 现在会扣 MTC；self_serve 用户访问付费功能被挡 |
| **#374** | `c0af273` | FeatureLockGate + ServerFeatureLock + /portal 路由淘汰 | self_serve 侧边栏看到 🔒；直访付费页 URL 只看到弹窗看不到内容；/portal/* 跳转到 /dashboard |
| **M-1~M-4** | `b2c4f0b` | 原子扣费 RPC + 原子限流 RPC + 退款失败落库 + blog precheck 不误退款 | 并发不会超扣/超限；退款失败有审计；博客生成失败不会白送 MTC |

**三档 tier 判定规则**（贯穿所有 case，先记住）：

| tier | 来源 | 能做什么 |
|------|------|---------|
| **admin** | env `ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAIN` 白名单 | 全部功能 + **MTC 扣费被 bypass**（内部 QA 不烧客户余额） |
| **paid_client** | `client_portal_users.access_type ∈ {client, dashboard, fde, both}` | 全部功能；消费类扣 MTC |
| **self_serve** | `client_portal_users.access_type = 'self_serve'` | 只能用 Visual Studio + Content；消费扣 MTC；**功能类（Goals/Strategy/Diagnostic/Execution/Connectors）被锁** |
| **portal_only** | `access_type = 'portal'`（prod 当前 0 行） | 不允许进 /dashboard |

**关键区分**（决定期望 HTTP code）：
- **付费墙端点**（用 `requirePaidClientAccess`）→ self_serve 收 **403 `reason='paid_only'`**。例：`/api/clients/[id]/goals`、`/strategy`、`/diagnostic` 系列。
- **消费类端点**（用 `requireDashboardClientAccess`）→ self_serve **能进**，但余额不足时收 **402 `insufficient_balance`** / 超月预算收 **429 `monthly_cap_reached`**。例：`/api/visual/image`、`/api/clients/[id]/blog`、`/social-plan`、`/zhangqian/discover`。

---

## A · PM 可独立完成（前端 smoke + curl + 简单 SQL）

> 只需要：浏览器 + 一个 admin 账号 + 一个 self_serve 账号 + Supabase Studio SQL 编辑器（service_role 视角）。不需要工程师。

### A 区 · 前端冒烟（浏览器）

---

#### T01 — self_serve 侧边栏显示付费功能锁

**目的**：确认 self_serve 用户的侧边栏把 Goals/Strategy/Diagnostic/Execution/Connectors 收进 🔒「Paid features」组。

**前置条件**：用 self_serve 账号登录（见文末「前置准备」§P4 拿账号）。

**操作步骤**：
1. 浏览器登录 `https://magicengine.com.au/login`，用 self_serve 账号
2. 进入 `/dashboard/clients/<self_serve_client_id>`
3. 看左侧 sidebar

**期望结果**：
- sidebar 顶部能看到 **Visual Studio** + **Content**（可点、正常导航）
- 下方有一个 🔒 **Paid features** 分组，包含 Goals / Strategy / Diagnostic / Execution / Connectors
- 点击其中任意一项 → **不跳转**，弹出 Talk-to-Us / Magic Lab Class 升级弹窗

**回归判定**：
- ✅ 通过：🔒 组存在 + 点击弹窗不导航
- ❌ 失败：self_serve 看到完整 nav（和 paid 一样）/ 点 Goals 真的进了 Goals 页

---

#### T02 — paid_client 侧边栏保持完整导航

**目的**：确认加锁逻辑没误伤付费客户。

**前置条件**：用 paid_client 账号登录（access_type ∈ {client/dashboard/fde/both}，prod 有 6 both + 2 dashboard）。

**操作步骤**：
1. 登录 paid_client 账号
2. 进入其 client dashboard
3. 看 sidebar

**期望结果**：
- 看到完整 nav：Goals / Strategy / Diagnostic / Execution / Connectors 全部可点且正常导航
- **没有** 🔒「Paid features」分组

**回归判定**：
- ✅ 通过：完整 nav，无锁
- ❌ 失败：付费客户也被锁（误伤）

---

#### T03 — self_serve 直访付费页 URL 只看到弹窗（SSR 不泄漏数据）

**目的**：确认 ServerFeatureLock 在服务端就把 children 拦掉 —— self_serve 即使手敲 URL 也看不到付费功能内容，DevTools 也搜不到。

**前置条件**：self_serve 账号已登录。

**操作步骤**：逐个直接在地址栏敲以下 7 个 URL（`<cid>` = self_serve 的 client_id）：
1. `/dashboard/clients/<cid>/diagnostic`
2. `/dashboard/clients/<cid>/strategy`
3. `/dashboard/clients/<cid>/execution`
4. `/dashboard/clients/<cid>/marketing-plan`
5. `/dashboard/clients/<cid>/goal/new`
6. `/dashboard/clients/<cid>/goal/<任意goalId>`
7. `/dashboard/clients/<cid>/goals/history`

对其中任意一个：右键 → 查看网页源代码（View Source），Ctrl+F 搜该功能应有的业务关键词（如 diagnostic 页搜 "维度" / strategy 页搜 "Initiative"）。

**期望结果**：
- 每个 URL 都只渲染一个**不可关闭**的升级弹窗（背景空白，无功能内容）
- View Source 里**搜不到**功能业务数据（children 根本没被 SSR 序列化）

**回归判定**：
- ✅ 通过：7 个页面全是弹窗 + 源码无业务数据
- ❌ 失败：任意页面能看到真实功能内容 / 源码里能搜到 Goal/诊断数据（= SSR 泄漏，H-1 没修住）

---

#### T04 — admin / paid_client 访问这 7 页正常渲染

**目的**：确认 ServerFeatureLock 对有权限的人放行。

**前置条件**：admin 或 paid_client 账号已登录。

**操作步骤**：访问 T03 同样的 7 个 URL（用各自有权限的 client_id）。

**期望结果**：7 个页面全部正常渲染功能内容（无升级弹窗）。

**回归判定**：
- ✅ 通过：7 页全部正常
- ❌ 失败：付费用户/admin 也被弹窗挡住（`readUserTier` 误判）

---

#### T05 — /portal/* 路由 308 跳转到 /dashboard

**目的**：确认旧 /portal 路径已淘汰、跳转到统一 /dashboard。

**前置条件**：任意已登录账号（admin 最方便）。

**操作步骤**：地址栏依次敲：
1. `/portal`
2. `/portal/<某真实clientId>`
3. `/portal/<某真实clientId>/diagnostic`

**期望结果**：
- `/portal` → 落到 `/dashboard`
- `/portal/<cid>` → 落到 `/dashboard/clients/<cid>`
- `/portal/<cid>/diagnostic` → 落到 `/dashboard/clients/<cid>/diagnostic`
- 跳转是 **308 Permanent Redirect**（见 T06 curl 验证 code）

**回归判定**：
- ✅ 通过：3 个路径全部落到对应 /dashboard URL
- ❌ 失败：404 / 停在 /portal / 跳错 client

---

#### T06 — /portal/login + /portal/register 仍可访问（旧书签兼容）

**目的**：确认淘汰 /portal 时保留了 login/register 两个页面（老书签不报错）。

**前置条件**：**退出登录**（无 session）。

**操作步骤**：
1. 地址栏敲 `/portal/login`
2. 地址栏敲 `/portal/register`

**期望结果**：两个页面都正常打开（**不** 308 跳转），显示登录/注册 UI。

**回归判定**：
- ✅ 通过：两页正常打开
- ❌ 失败：被 308 跳走 / 404

---

### A 区 · curl 验证（命令行）

> curl 需要带登录后的 Supabase session cookie，见文末 §P5 抓 cookie 的方法。下面 `$COOKIE` = 抓到的整串 `sb-...-auth-token` cookie。

---

#### T07 — self_serve 调付费墙 API 收 403 paid_only

**目的**：确认后端付费墙对 self_serve 返回结构化 403（前端据此弹窗）。

**前置条件**：self_serve 账号的 session cookie（`$SS_COOKIE`），其 client_id = `$SS_CID`。

**操作步骤**：
```bash
curl -i -X GET "https://magicengine.com.au/api/clients/$SS_CID/goals" \
  -H "Cookie: $SS_COOKIE"
```

**期望结果**：
- HTTP **403**
- body JSON 含 `"reason":"paid_only"`，error 文案含 "requires a paid plan"

**回归判定**：
- ✅ 通过：403 + `reason=paid_only`
- ❌ 失败：200（self_serve 拿到了付费数据）/ 401 / 500

---

#### T08 — paid_client 调同一付费墙 API 收 200

**目的**：付费墙对付费客户放行。

**前置条件**：paid_client session cookie（`$PC_COOKIE`），client_id = `$PC_CID`。

**操作步骤**：
```bash
curl -i -X GET "https://magicengine.com.au/api/clients/$PC_CID/goals" \
  -H "Cookie: $PC_COOKIE"
```

**期望结果**：HTTP **200**，body 为正常 goals 列表 JSON。

**回归判定**：
- ✅ 通过：200 + 正常数据
- ❌ 失败：403（付费客户被误挡）

---

#### T09 — 无 session 调任意 client API 收 401

**目的**：确认 29 个之前裸奔的路由现在都要 auth（IDOR 已堵）。

**前置条件**：**不带任何 cookie**。`$ANY_CID` = 任意真实 client_id。

**操作步骤**：
```bash
curl -i -X GET  "https://magicengine.com.au/api/clients/$ANY_CID/goals"          # 无 cookie
curl -i -X POST "https://magicengine.com.au/api/clients/$ANY_CID/social-plan"    # 无 cookie
curl -i -X POST "https://magicengine.com.au/api/visual/image" \
  -H "Content-Type: application/json" \
  -d '{"post_id":"x","client_id":"'$ANY_CID'"}'                                   # 无 cookie
```

**期望结果**：三条都返回 **401**（unauthorized），不返回任何业务数据。

**回归判定**：
- ✅ 通过：全部 401
- ❌ 失败：任意一条返回 200 / 把数据吐出来了（= IDOR 仍在）

---

#### T10 — /portal/* 308 的 HTTP code 实测

**目的**：用 curl 确认 T05 的跳转确实是 308（不是 301/302/307）。

**前置条件**：admin session cookie。`$CID` = 真实 client_id。

**操作步骤**：
```bash
curl -i -X GET "https://magicengine.com.au/portal/$CID/diagnostic" \
  -H "Cookie: $ADMIN_COOKIE"
```

**期望结果**：
- 状态行 **`HTTP/.. 308`**
- 响应头 `location: /dashboard/clients/<CID>/diagnostic`

**回归判定**：
- ✅ 通过：308 + location 指向 dashboard 等价路径
- ❌ 失败：非 308 / location 错

---

### A 区 · 简单 SQL（Supabase Studio，service_role）

> 在 Supabase Studio → SQL Editor 跑。全部 service_role 视角，可直接读写。

---

#### T11 — 7 张表 / 列全部存在（migration 真的 apply 了）

**目的**：确认 7 个 migration 在 prod 落地，不是只在仓库里。

**操作步骤**：
```sql
-- 4 张新表必须存在
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public'
   AND table_name IN (
     'signup_bonus_grants',
     'zhangqian_scan_rate_limits',
     'zhangqian_scan_domain_cache',
     'mtc_refund_failures'
   )
 ORDER BY table_name;

-- reels_drafts / blog_posts 的 3 个 MTC 列必须存在
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema='public'
   AND table_name IN ('reels_drafts','blog_posts')
   AND column_name IN ('mtc_service_key','mtc_projected','mtc_committed')
 ORDER BY table_name, column_name;
```

**期望结果**：
- 第一条返回 **4 行**（4 张表全在）
- 第二条返回 **6 行**（2 表 × 3 列）

**回归判定**：
- ✅ 通过：4 行 + 6 行
- ❌ 失败：行数不足（= 某个 migration 没 apply，参考 schema-drift 事故）

---

#### T12 — 2 个 RPC 函数存在且签名正确

**目的**：确认并发安全的两个 RPC 已建（PR #373 / M-1 + M-4）。

**操作步骤**：
```sql
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public'
   AND p.proname IN ('mtc_deduct_atomic','zhangqian_rate_limit_consume')
 ORDER BY p.proname;
```

**期望结果**：返回 **2 行**：
- `mtc_deduct_atomic` — args 含 `p_client_id uuid, p_service_key text, p_mtc_amount integer, ...`
- `zhangqian_rate_limit_consume` — args 含 `p_bucket_type text, p_bucket_key text, p_window_start timestamp with time zone, p_cap integer`

**回归判定**：
- ✅ 通过：2 行都在
- ❌ 失败：缺任一函数（JS 会 fallback 到非原子路径，并发不安全）

---

#### T13 — access_type CHECK 约束已加 'client'

**目的**：确认 tier auth 的 6 值 CHECK 约束在 prod 生效。

**操作步骤**：
```sql
SELECT pg_get_constraintdef(c.oid) AS check_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
 WHERE t.relname='client_portal_users'
   AND c.conname='client_portal_users_access_type_check';
```

**期望结果**：返回 1 行，约束定义里 6 个值全在：`'portal','dashboard','fde','both','self_serve','client'`。

**回归判定**：
- ✅ 通过：6 值全在，含 'client'
- ❌ 失败：缺 'client'（升级路径 UPDATE 会被 CHECK 拒）

---

#### T14 — 当前用户 tier 分布符合预期（portal-only = 0）

**目的**：确认 PR #374 的 DB pre-flight 真把 2 个 example.com portal 测试号删了。

**操作步骤**：
```sql
SELECT access_type, count(*) AS n
  FROM client_portal_users
 GROUP BY access_type
 ORDER BY access_type;
```

**期望结果**（按 PR 描述基线，允许后续真实新增浮动）：
- `both` ≈ 6
- `dashboard` ≈ 2
- `self_serve` ≥ 1
- `portal` = **0**（关键：必须 0 行）

**回归判定**：
- ✅ 通过：`portal` = 0
- ❌ 失败：`portal` > 0（淘汰没做干净，仍有 portal-only 用户会被挡在 /dashboard 外）

---

## B · 需要 FDE 配合（内部账号 + Supabase Studio 写操作）

> 这一区要真实触发扣费 / 退款 / 限流，需要 FDE 用内部 self_serve 测试账号操作，并配合在 Supabase 改余额、看 ledger。**涉及钱的 case 都写了「执行前 / 执行后」预期数字**。

> ⚠️ FDE 操作前先确认：用的是**测试用 self_serve 客户**，不是真实付费客户。改余额、烧 MTC 都只在测试客户上做。

---

#### T15 — self_serve 生成单图扣 10 MTC（happy path）

**目的**：确认 `image_single` 真扣 10 MTC（PR #370 核心）。

**前置条件**：
- 测试 self_serve 客户 `$T_CID`，余额充足（≥ 50 MTC）
- 该客户有一个带 `visual_brief` 的 content_posts 行，记其 `post_id` = `$POST_ID`

**执行前 — 记录余额**：
```sql
SELECT COALESCE(SUM(mtc_remaining),0) AS balance
  FROM mtc_purchases
 WHERE client_id='$T_CID' AND status='completed' AND expires_at > NOW();
-- 记下这个数，叫 BEFORE
```

**操作步骤**：在该客户 dashboard 的内容工作台点「生成图片」（或 curl）：
```bash
curl -i -X POST "https://magicengine.com.au/api/visual/image" \
  -H "Content-Type: application/json" -H "Cookie: $T_COOKIE" \
  -d '{"post_id":"'$POST_ID'","client_id":"'$T_CID'"}'
```

**期望结果**：
- HTTP **200**，body `success:true` + `asset_id` + `storage_url`
- **执行后余额 = BEFORE − 10**

**执行后 — 验证**：
```sql
-- 余额应减 10
SELECT COALESCE(SUM(mtc_remaining),0) AS balance_after
  FROM mtc_purchases
 WHERE client_id='$T_CID' AND status='completed' AND expires_at > NOW();

-- ledger 应有一条 debit 10 / image_single
SELECT direction, service_key, mtc_amount, source, created_at
  FROM mtc_ledger
 WHERE client_id='$T_CID' AND service_key='image_single'
 ORDER BY created_at DESC LIMIT 1;
```

**回归判定**：
- ✅ 通过：`balance_after = BEFORE − 10` 且 ledger 有 debit/image_single/10
- ❌ 失败：余额没变（没扣）/ 扣了别的数 / 无 ledger 行

---

#### T16 — 余额不足时生图收 402 且不扣

**目的**：确认 `chargeForGeneration` 余额不足返回干净 402，且不产生扣费。

**前置条件**：把测试客户余额压到 < 10 MTC。
```sql
-- 把所有未过期 completed 批次余额清到 5（仅测试客户！）
UPDATE mtc_purchases SET mtc_remaining = 5
 WHERE client_id='$T_CID' AND status='completed' AND expires_at > NOW();
```

**操作步骤**：同 T15 的 curl 生图。

**期望结果**：
- HTTP **402**
- body 含 `"reason":"insufficient_balance"`，`balance:5`，`required:10`，error 文案含「余额不足」
- ledger **没有**新增 debit 行（不扣）

**执行后 — 验证**：
```sql
SELECT COALESCE(SUM(mtc_remaining),0) FROM mtc_purchases
 WHERE client_id='$T_CID' AND status='completed' AND expires_at > NOW();
-- 应仍为 5，没被扣
```

**回归判定**：
- ✅ 通过：402 + reason=insufficient_balance + 余额仍 5
- ❌ 失败：扣了款 / 返回 500 / 余额变负

---

#### T17 — 生图失败自动退款（refund-on-fail）

**目的**：确认生成阶段抛错时 MTC 退回（先扣后退，净额 0）。

**前置条件**：测试客户余额 ≥ 50。需要工程师配合制造一次 OpenAI 生成失败（或用一个会触发上传失败的坏 post）。**若无法稳定制造失败，此 case 转 C 区由工程师跑**。

**执行前**：记录 BEFORE 余额（同 T15）。

**操作步骤**：触发一次注定失败的生图（坏 prompt / 临时改坏图片服务配置）。

**期望结果**：
- HTTP **500**（生成失败）
- ledger 出现**成对**的 debit 10 + refund(credit) 10，净额为 0
- **执行后余额 = BEFORE**（先扣 10 又退 10）

**执行后 — 验证**：
```sql
SELECT direction, service_key, mtc_amount, source, notes, created_at
  FROM mtc_ledger
 WHERE client_id='$T_CID' AND reference_id='$POST_ID'
 ORDER BY created_at DESC LIMIT 4;
-- 应看到 debit image_single 10 + credit image_single 10 (source=refund, notes 含 'Auto-refund')
```

**回归判定**：
- ✅ 通过：debit + refund 成对，余额回到 BEFORE
- ❌ 失败：只扣不退（客户被白扣）/ 退多了 / 退了但没记 ledger

---

#### T18 — 博客生成成功只在完成时扣费（precheck → commit）

**目的**：确认 blog 是异步「先 precheck 后 commit」模型 —— POST 时不扣，后台成功才扣。

**前置条件**：测试客户余额 ≥ 100。

**执行前**：记录 BEFORE 余额。

**操作步骤**：
1. 在该客户触发一篇 SEO 博客生成（mode=seo → blog_seo = 40 MTC）
2. 立刻（POST 返回后 1 秒内）查余额 —— 此刻**不应**已扣
3. 等后台生成完成（轮询 status 到 ready）
4. 再查余额

**期望结果**：
- POST 立即返回，**此刻余额 = BEFORE**（precheck 不扣）
- 后台完成后 **余额 = BEFORE − 40**
- `blog_posts` 该行 `mtc_committed=true`、`mtc_projected=40`

**执行后 — 验证**：
```sql
SELECT id, status, mtc_service_key, mtc_projected, mtc_committed
  FROM blog_posts
 WHERE client_id='$T_CID'
 ORDER BY created_at DESC LIMIT 1;
-- status=完成态, mtc_committed=true, mtc_projected=40

SELECT direction, service_key, mtc_amount FROM mtc_ledger
 WHERE client_id='$T_CID' AND service_key='blog_seo'
 ORDER BY created_at DESC LIMIT 1;
-- debit blog_seo 40
```

**回归判定**：
- ✅ 通过：POST 时不扣，完成后扣 40，committed=true
- ❌ 失败：POST 时就扣了（precheck 误扣）/ 完成了没扣

---

#### T19 — 博客 precheck-only 失败不误退款（M-2 latent bug 修复）

**目的**：确认 blog 在「从没 commit 过」就失败时**不会**错误地 credit MTC（修了 f90f84c 的白送 bug）。

**前置条件**：测试客户余额 ≥ 100。需要让博客生成在 commit 之前就失败（如 LLM 超时 / 校验失败）。**若无法稳定制造，转 C 区。**

**执行前**：记录 BEFORE 余额。

**操作步骤**：触发一篇注定在 commit 前失败的博客。

**期望结果**：
- `blog_posts` 行 `status=failed`、`mtc_committed` 最终为 `true`（被翻成 true 以短路重试），但**从未真正扣过款**
- ledger **没有** blog 的 debit，也**没有** blog 的 refund credit
- **执行后余额 = BEFORE**（既没扣也没退，净额 0 且无幽灵 credit）

**执行后 — 验证**：
```sql
SELECT id, status, mtc_committed, mtc_projected FROM blog_posts
 WHERE client_id='$T_CID' ORDER BY created_at DESC LIMIT 1;
-- status=failed

-- 关键：不应有 blog 的 credit/refund 行
SELECT direction, service_key, mtc_amount, source FROM mtc_ledger
 WHERE client_id='$T_CID'
   AND service_key IN ('blog_seo','blog_dual_signal')
 ORDER BY created_at DESC LIMIT 3;
-- 期望：没有 source=refund 的 credit 行
```

**回归判定**：
- ✅ 通过：余额 = BEFORE，**无** refund credit 行
- ❌ 失败：出现 blog refund credit（= 白送 MTC，latent bug 复活）

---

#### T20 — 张骞 discover 扣 60 MTC（self_serve）+ admin bypass

**目的**：确认 `/zhangqian/discover` 对 self_serve 扣 60，对 admin 不扣。

**前置条件**：测试 self_serve 客户余额 ≥ 100，有 domain。

**执行前**：记录 BEFORE 余额。

**操作步骤（self_serve）**：
```bash
curl -i -X POST "https://magicengine.com.au/api/clients/$T_CID/zhangqian/discover" \
  -H "Content-Type: application/json" -H "Cookie: $T_COOKIE" -d '{}'
```
等后台 job 完成（轮询 `/zhangqian/status?job_id=...`）。

**期望结果（self_serve，成功路径）**：
- POST 返回 **202** + `job_id`
- 后台成功后 **余额 = BEFORE − 60**，ledger 有 debit zhangqian_discover 60

**期望结果（admin 对照）**：用 admin 账号对同客户跑一次 → 完成后**余额不变**（admin bypass）。

**执行后 — 验证**：
```sql
SELECT direction, service_key, mtc_amount FROM mtc_ledger
 WHERE client_id='$T_CID' AND service_key='zhangqian_discover'
 ORDER BY created_at DESC LIMIT 1;
-- self_serve 跑出来：debit 60；admin 跑：无新增行
```

**回归判定**：
- ✅ 通过：self_serve 扣 60 + admin 不扣
- ❌ 失败：self_serve 没扣 / admin 也扣了客户的钱

---

#### T21 — 张骞 discover 失败退款 60

**目的**：确认 discover 在 validation/agent 失败时退回 60 MTC。

**前置条件**：能制造一次 discover 失败（坏 domain / agent 校验失败）。**难稳定制造则转 C 区。**

**执行前**：记录 BEFORE 余额。

**期望结果**：job 标 failed 后 **余额 = BEFORE**（扣 60 又退 60），ledger 有成对 debit + refund(credit) zhangqian_discover 60，refund notes 含 "zhangqian ... failed"。

**回归判定**：
- ✅ 通过：成对 debit+refund，余额回 BEFORE
- ❌ 失败：只扣不退 / 退款没落账

---

#### T22 — social-plan 按实际交付单位计费（dynamic per unit）

**目的**：确认社媒计划按 reels×N + posts×N + stories×N 真实条数计费，不是固定价。

**前置条件**：测试客户余额 ≥ 200，有 active master_brief + 一个 campaign_brief（记 `$CAMP_ID`）。

**执行前**：记录 BEFORE 余额。

**操作步骤**：
```bash
curl -i -X POST "https://magicengine.com.au/api/clients/$T_CID/social-plan" \
  -H "Content-Type: application/json" -H "Cookie: $T_COOKIE" \
  -d '{"campaign_brief_id":"'$CAMP_ID'","reels_count":2,"posts_count":3,"stories_count":1}'
```

**期望结果**（单价：social_series/reels 块按实现读 MTC_RATES；post=5、story=3，以路由实际交付为准）：
- HTTP **200** + `plan_id`
- 扣费 = 实际交付的各单元单价之和（**按交付计，欠交付只会更少不会更多**）
- ledger 出现对应 social 类 debit 行

**执行后 — 验证**：
```sql
SELECT direction, service_key, mtc_amount, created_at FROM mtc_ledger
 WHERE client_id='$T_CID'
   AND service_key LIKE 'social%'
 ORDER BY created_at DESC LIMIT 5;
-- 核对扣费条目与实际生成的 reels/posts/stories 数量对得上
```

**回归判定**：
- ✅ 通过：扣费 = 实际交付单元之和，且「交付不足时扣得更少」
- ❌ 失败：固定价 / 扣得比实际交付多

---

#### T23 — 签注 500 MTC bonus 邮箱级幂等（Gmail 别名收敛）

**目的**：确认同一 Gmail 的别名（+alias / 加点 / googlemail）只能拿一次 500 MTC bonus（H2 修复）。

**前置条件**：FDE 能走 self_serve 注册 + 邮箱验证流程（拿一个可控 Gmail）。

**操作步骤**：
1. 用 `tester@gmail.com` 注册 self_serve + 验证 → 触发 bonus
2. 再用 `tester+2@gmail.com` 注册 + 验证
3. 再用 `te.ster@gmail.com` 注册 + 验证

**期望结果**：
- 只有**第一次**真正发 500 MTC
- 第 2、3 次 `grantSignupBonus` 返回 false（命中 canonical 唯一约束），不再发 MTC
- `signup_bonus_grants` 表里 `email_canonical='tester@gmail.com'` 只有 **1 行**

**执行后 — 验证**：
```sql
SELECT email_canonical, email_lower, mtc_amount, granted_at
  FROM signup_bonus_grants
 WHERE email_canonical='tester@gmail.com';
-- 期望：1 行，mtc_amount=500

-- 三个客户里只有第一个有 bonus_500 批次
SELECT c.id, p.package_key, p.mtc_amount
  FROM mtc_purchases p JOIN clients c ON c.id=p.client_id
 WHERE p.package_key='bonus_500'
   AND c.id IN ('<clientA>','<clientB>','<clientC>');
-- 期望：只有 clientA 有 bonus_500 行
```

**回归判定**：
- ✅ 通过：canonical 1 行 + 只有第一个客户拿到 500
- ❌ 失败：每个别名都拿到 500（= 刷 bonus 漏洞还在）

> 注意命名：bonus 的实际金额是 **500 MTC**（`BONUS_MTC_AMOUNT`）。ledger 行的 `service_key` 写成 `bonus_registration`（这是个标签），**不要**被 `MTC_RATES.bonus_registration=100` 误导 —— 那个 100 不参与 bonus 金额计算。

---

#### T24 — 张骞 public scan 限流：同 IP 第 4 次当天被挡

**目的**：确认持久化限流 3/天/维度生效（H3 修复），Render 重启后仍有效。

**前置条件**：FDE 能调 public scan 入口（`/api/public-scan/start` 或 `/api/discover/register`，按实际公开入口），固定同一 IP + 同一 domain。

**操作步骤**：当天对同一 domain 连续发起 **4 次** public scan（同 IP）。

**期望结果**：
- 第 1–3 次：允许（counter 累加到 3）
- 第 4 次：被挡（`allowed:false` / `blockedBy`），不再创建新 job、不再烧 $0.57
- 同 domain 24h 内重复请求：命中 domain cache，复用旧 job_id（不重跑 agent）

**执行后 — 验证**：
```sql
-- 当天该 IP 维度计数应达到 cap
SELECT bucket_type, bucket_key, window_start, count
  FROM zhangqian_scan_rate_limits
 WHERE bucket_type='ip'
   AND window_start = date_trunc('day', now() AT TIME ZONE 'UTC')
 ORDER BY count DESC LIMIT 5;
-- count >= 3

-- domain cache 应有该 domain 的指针
SELECT domain, job_id, job_status, cached_at
  FROM zhangqian_scan_domain_cache
 WHERE domain='<被测domain去掉www>'
 ORDER BY cached_at DESC LIMIT 1;
```

**回归判定**：
- ✅ 通过：第 4 次被挡 + counter≥3 + domain cache 命中复用
- ❌ 失败：第 4 次仍放行（限流没生效）/ 每次都重跑 agent（cache 没生效）

---

## C · 需要工程师（并发压测 + prod RPC 直查 + 失败模拟）

> 这一区涉及并发竞态、直接调 RPC、人为制造退款失败 —— 需要工程师用脚本 / psql / service_role key 跑。

---

#### T25 — `mtc_deduct_atomic` 并发安全：50 余额 × 两个 40 扣费

**目的**：确认原子扣费 RPC 在并发下只有一个成功（M-1 核心），不会双双扣穿。

**前置条件**：工程师有 service_role 连接。准备一个测试客户，余额精确设为 **50**：
```sql
-- 清掉旧批次，建一个正好 50 的批次（测试客户）
UPDATE mtc_purchases SET mtc_remaining=0
 WHERE client_id='$T_CID' AND status='completed';
INSERT INTO mtc_purchases (client_id, package_key, amount_nzd, mtc_amount, mtc_remaining,
                           purchased_at, expires_at, status)
VALUES ('$T_CID','starter_99',0,50,50, now(), now()+interval '1 year','completed');
```

**操作步骤**：**并发**发起两个 `mtc_deduct_atomic(client, 'image_single', 40)`（用脚本同时打两条 RPC，或 psql 两 session）：
```sql
SELECT * FROM mtc_deduct_atomic('$T_CID','image_pack_4',40,'concurrency-test','auto','M1 test');
```

**期望结果**：
- 一个返回 `ok=true`（balance_remaining=10）
- 另一个返回 `ok=false`（insufficient_balance，balance_remaining=10）
- **绝不出现两个 ok=true**

**执行后 — 验证**：
```sql
SELECT COALESCE(SUM(mtc_remaining),0) AS final FROM mtc_purchases
 WHERE client_id='$T_CID' AND status='completed' AND expires_at>NOW();
-- final 必须 = 10（只扣一次 40），不能是 -30 或 10 以外的值

SELECT count(*) AS debit_rows FROM mtc_ledger
 WHERE client_id='$T_CID' AND direction='debit'
   AND reference_id='concurrency-test';
-- debit_rows 必须 = 1（只成功扣一次）
```

**回归判定**：
- ✅ 通过：1 成功 1 失败 + 最终余额 10 + 仅 1 条 debit
- ❌ 失败：两个都 ok=true / 余额变负 / 2 条 debit（= 竞态没堵住）

---

#### T26 — `zhangqian_rate_limit_consume` 并发安全：cap=3 被 5 并发命中

**目的**：确认原子限流 RPC 在并发下不会超过 cap+少量（M-4 核心），且超 cap 的返回 allowed=false。

**前置条件**：工程师 service_role 连接。选一个全新的 bucket（当天没用过的 IP/domain）。

**操作步骤**：用同一 `(bucket_type, bucket_key, window_start)` **并发**打 5 次：
```sql
SELECT * FROM zhangqian_rate_limit_consume(
  'ip','203.0.113.99', date_trunc('day', now() AT TIME ZONE 'UTC'), 3);
```

**期望结果**：
- 前 3 次（post_count 1/2/3）返回 `allowed=true`
- 第 4、5 次返回 `allowed=false`（post_count 4/5）
- 即使并发，最终 count 落在确定值，且任何 post_count>3 的调用 `allowed` 必为 false

**执行后 — 验证**：
```sql
SELECT count FROM zhangqian_scan_rate_limits
 WHERE bucket_type='ip' AND bucket_key='203.0.113.99'
   AND window_start = date_trunc('day', now() AT TIME ZONE 'UTC');
-- count = 5（5 次都 INSERT/INCREMENT 了），但只有前 3 个 allowed=true
```

**回归判定**：
- ✅ 通过：≤3 的 allowed=true，>3 的 allowed=false，无竞态导致的「第 4 次 allowed=true」
- ❌ 失败：并发下出现第 4+ 次 allowed=true（cap 被击穿）

---

#### T27 — 退款失败落库 `mtc_refund_failures`（M-2 审计）

**目的**：确认 refundOnFail 自身失败时写审计行（不再 console 黑洞）。

**前置条件**：工程师能让 `refundMtc` 失败（如临时 mock / 改坏 ledger 插入），再触发一次需要退款的生成失败（接 T17 场景）。

**操作步骤**：制造「生成失败 → 触发退款 → 退款本身也失败」的链路。

**期望结果**：
- `mtc_refund_failures` 新增 1 行：`client_id` / `service_key` / `mtc_amount`（=本该退的额）/ `status='pending'` / `last_error` 非空
- 原始生成失败不被退款失败掩盖（generation 错误照常返回）

**执行后 — 验证**：
```sql
SELECT client_id, service_key, mtc_amount, status, failure_reason, last_error, created_at
  FROM mtc_refund_failures
 WHERE client_id='$T_CID'
 ORDER BY created_at DESC LIMIT 1;
-- status='pending', mtc_amount = 应退金额, last_error 有内容

-- ops sweep 查询（partial index 命中）应能找到它
SELECT count(*) FROM mtc_refund_failures WHERE status='pending';
```

**回归判定**：
- ✅ 通过：pending 行落库，字段完整，应退金额正确
- ❌ 失败：退款失败仍只 console / 无审计行（应退未退无法追溯）

---

#### T28 — RPC 输入防御：负数 / 0 金额被拒

**目的**：确认两个 RPC 对非法输入 RAISE EXCEPTION，不静默乱写。

**前置条件**：工程师 service_role 连接。

**操作步骤**：
```sql
-- 负/零金额扣费 → 应抛异常
SELECT * FROM mtc_deduct_atomic('$T_CID','image_single', 0,'neg-test');     -- 期望报错
SELECT * FROM mtc_deduct_atomic('$T_CID','image_single', -5,'neg-test');    -- 期望报错

-- cap<=0 → 应抛异常
SELECT * FROM zhangqian_rate_limit_consume('ip','1.1.1.1', now(), 0);       -- 期望报错
```

**期望结果**：
- 前两条报 `mtc_amount must be positive (got ...)`
- 第三条报 `cap must be positive (got 0)`
- 三条都**不**写入任何 ledger / counter 行

**执行后 — 验证**：
```sql
SELECT count(*) FROM mtc_ledger
 WHERE client_id='$T_CID' AND reference_id='neg-test';
-- 必须 = 0（异常时没插入）
```

**回归判定**：
- ✅ 通过：三条全部 RAISE EXCEPTION + 无脏数据
- ❌ 失败：负数/0 被接受并写库

---

#### T29 — 张骞限流 RPC 失败时 JS fallback 不阻断（降级路径）

**目的**：确认 `consumeScanRateLimits` 在 RPC 报错时降级到非原子 upsert + 放行（loud warn），不让限流故障卡死公开扫描入口。

**前置条件**：工程师能临时让 RPC 调用失败（如临时 rename 函数或 mock rpc 返回 error）。

**操作步骤**：在 RPC 不可用的情况下，走一次 public scan 限流检查。

**期望结果**：
- 日志出现 `[rate-limiter] atomic RPC failed, falling back`
- 请求**不被卡死**（降级为非原子 upsert，treat as allowed）
- `zhangqian_scan_rate_limits` 仍有计数行被写入（fallback 的 upsert 生效）

**回归判定**：
- ✅ 通过：降级路径放行 + 有 warn 日志 + counter 仍写入
- ❌ 失败：RPC 一坏整个公开扫描 500（无降级）

---

#### T30 — self_serve → paid 升级 cleanupPending（PR #373 upgrade 路径）

**目的**：确认 self_serve 升级为 paid（access_type → 'client'）时，pending 状态被正确清理（`cleanupPending` 字段）。

**前置条件**：工程师 / FDE 拿一个 self_serve 测试客户走升级流程（`src/lib/auth/upgrade-self-serve.ts`）。

**操作步骤**：对测试 self_serve 客户执行升级（按 upgrade-self-serve 流程触发）。

**期望结果**：
- `client_portal_users.access_type` 从 `self_serve` 变为 `client`
- 升级后该用户 tier = paid_client（T01 的锁消失，T07 的付费墙放行）
- pending 项按 `cleanupPending` 逻辑被清理（无悬挂状态）

**执行后 — 验证**：
```sql
SELECT email, access_type FROM client_portal_users
 WHERE client_id='$T_CID';
-- access_type='client'（不再 self_serve）
```
再跑一次 T07 的 curl（现在应得 200，不再 403 paid_only）。

**回归判定**：
- ✅ 通过：access_type=client + 付费墙放行 + 无 pending 残留
- ❌ 失败：仍 self_serve / 升级后仍被锁 / pending 悬挂

---

## P · 测试前置准备清单

> 开跑前把这些备齐。缺哪项对应区块就跑不了。

### P1 · 环境与项目

| 项 | 值 / 来源 |
|----|----------|
| 生产域名 | `https://magicengine.com.au` |
| Supabase 项目 | CrazyContent（ref `glbdnayojixmexgofbsd`） |
| Supabase SQL 入口 | Supabase Studio → SQL Editor（默认 service_role 视角，可直接读写） |
| 部署确认 | 跑前确认 Render 已部署到最新 `main`（含 `b2c4f0b`） |

### P2 · 关键服务端配置（Render env，工程师确认）

| 变量 | 作用 | 影响的 case |
|------|------|------------|
| `ADMIN_EMAILS` / `ADMIN_EMAIL_DOMAIN` | 决定谁是 admin（MTC bypass） | T04 / T20 admin 对照 |
| `INTERNAL_API_KEY` | 内部 Bearer（部分内部调用） | C 区脚本如走内部入口 |
| Supabase `SUPABASE_SERVICE_ROLE_KEY` | service_role 直查 / RPC | 全部 SQL + C 区 RPC |

### P3 · 账号清单（必须备齐 3 类）

| 角色 | access_type | 数量 | 用途 |
|------|-------------|------|------|
| **admin** | env 白名单（不在 DB） | 1 | T04 / T10 / T20 bypass 对照 |
| **paid_client** | `client/dashboard/fde/both` | 1（prod 现成 6 both + 2 dashboard 可借真实非破坏性 GET） | T02 / T08 |
| **self_serve（测试专用）** | `self_serve` | 1 | T01 / T03 / T07 + B 区**全部扣费/退款**（不要用真实付费客户烧钱） |

> ⚠️ B 区所有「改余额 / 烧 MTC / 制造失败」**只能在测试 self_serve 客户上做**。误操作真实客户余额属事故。

### P4 · 测试 self_serve 客户准备（FDE 建好备用）

跑 B 区前，FDE 准备一个测试 self_serve 客户，并确保：
- 有 `domain`（T20 张骞需要）
- 有 active `master_briefs` + 一个 `campaign_briefs`（T22 social-plan 需要）
- 有至少一个带 `visual_brief` 的 `content_posts`（T15 生图需要）
- 充值一笔可控余额（建议建一个 mtc_purchases 批次，方便 T25 精确设 50）

记下这些值供 curl/SQL 替换：
```
$T_CID    = 测试 self_serve 客户的 clients.id
$POST_ID  = 该客户一个带 visual_brief 的 content_posts.id
$CAMP_ID  = 该客户一个 campaign_briefs.id
```

### P5 · 抓登录 cookie（curl 用）

curl 调 `/api/...` 需要带 Supabase session cookie：
1. 浏览器登录对应账号（admin / paid_client / self_serve）
2. F12 → Application → Cookies → `https://magicengine.com.au`
3. 复制名为 `sb-<project>-auth-token`（可能分片 `.0` `.1`）的**全部** cookie 串
4. 拼成 `Cookie:` 头：`sb-xxx-auth-token=...; sb-xxx-auth-token.1=...`

按账号分别存：
```
$ADMIN_COOKIE = admin 的 cookie 串
$PC_COOKIE    = paid_client 的 cookie 串（$PC_CID = 其 client_id）
$SS_COOKIE / $T_COOKIE = self_serve 测试客户的 cookie 串（$SS_CID / $T_CID = 其 client_id）
```

### P6 · 通用「记余额」SQL（B 区每个扣费 case 前后都用）

```sql
-- 余额（未过期 completed 批次的 mtc_remaining 合计）
SELECT COALESCE(SUM(mtc_remaining),0) AS balance
  FROM mtc_purchases
 WHERE client_id='$T_CID' AND status='completed' AND expires_at > NOW();

-- 最近 10 条 ledger（看扣/退）
SELECT direction, service_key, mtc_amount, source, reference_id, created_at
  FROM mtc_ledger
 WHERE client_id='$T_CID'
 ORDER BY created_at DESC LIMIT 10;
```

### P7 · MTC 单价速查（核对扣费金额用）

| service_key | MTC | 触发端点 |
|-------------|-----|---------|
| `image_single` | 10 | POST `/api/visual/image` |
| `blog_seo` | 40 | POST `/api/clients/[id]/blog`（mode=seo） |
| `blog_dual_signal` | 60 | POST `/api/clients/[id]/blog`（mode=unified） |
| `zhangqian_discover` | 60 | POST `/api/clients/[id]/zhangqian/discover` |
| `social_post` | 5 | social-plan 每帖 |
| `social_series` | 20 | social-plan reels 块 |
| `social_calendar` | 30 | social-plan |
| `social_story` | 3 | social-plan 每 story |
| `reels_storyboard` | 5 | POST `.../generate-storyboard` |
| `reels_480p_6s` / `720p_6s` / `720p_10s` / `720p_15s` | 20 / 30 / 50 / 80 | POST `.../generate-video` |
| 签注 bonus | **500**（金额）| 自动发放，幂等键=canonical email |
| 月预算上限 | 默认 **5000** / 月（`clients.monthly_mtc_cap` 可覆盖） | 超出收 429 |

---

## 执行顺序建议

1. **先跑 A 区**（PM 独立，~40 分钟）：T11–T14 SQL 先确认 migration 落地 → T01–T10 前端/curl。任一 SQL 失败先停（说明部署/migration 有问题，后面白跑）。
2. **A 区全绿后跑 B 区**（FDE 配合，~1.5 小时）：先 T15/T16/T18 happy + 余额边界，再 T23/T24 幂等限流，失败模拟类（T17/T19/T21）能稳定复现就跑、否则标记转 C。
3. **C 区由工程师集中跑**（~1 小时）：并发压测 T25/T26 是重点（PR #373 的核心价值），RPC 防御 T28，失败落库 T27，降级 T29，升级 T30。

**整体回归判定**：A 区全绿 = 部署+鉴权+前端锁 OK 可放心；B 区全绿 = 扣费/退款/幂等真实生效；C 区全绿 = 并发与审计可上量。三区全绿才算「self-serve readiness 通过」。
