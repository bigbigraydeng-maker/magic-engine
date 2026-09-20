# Meta Ads AI Connector V0.1 — build receipt / Issue #1839

状态：默认关闭的 Draft 实现；GO BUILD 授权已收到。没有 merge、deploy、生产 migration 或真实广告写入。Discovery 原稿保留在同目录 `2026-09-20-meta-ads-ai-connector-v01.md`，其中 STOP 是当时的决策节点。

Repository Fact Gate：2026-09-20T06:41:21Z fetched，施工基线 main `edfeb2eea144f71be295bc55f07201aba0be75a0`。风险 A（鉴权、隔离、schema、外部接口）。按 §11：频率中 / IMPACT 中 / 收入中 → P2，PO 显式 GO BUILD 后执行。

Tier Classification：既有 Ads 支柱下 L3 Meta Connector + 共享身份/工具出口扩展。不是新支柱、不是独立 intelligence。换 CTS、Roman 或其他行业不改变 shared runtime；无客户名、ID、行业语义写进逻辑；无 memory 写入。

## 实现与复用

- 复用 Meta OAuth app、现有 token exchange、platform_oauth_connections 加密库、client_api_keys、client access guards、现有 MCP endpoint、client_binding_audit 和 mcp_access_log。没有第二套 Meta app、凭证库、广告执行入口或 MCP server。
- 新增 purpose=`meta_ads_read`（User token，`ads_user:<id>` 命名空间）。旧凭证默认 `legacy`，旧 token manager 显式过滤。Meta Page/Messenger/CAPI 不使用新只读授权。
- `meta_ads_read_grants` 表达只读 consent，不写 clients.meta_ad_account_id 或 client_meta_ad_accounts，不让免费用户进入 operational registry / cron / write ownership。
- 新旧账户写入口共用数据库锁和冲突触发器。检查旧单账户列、旧多账户表和新 grant；允许旧历史共用继续存在，但禁止建立新的跨租户 public grant。Unicode NFKC / Cf / 前导零及分隔多值均识别。
- 强 nonce 一次消费，绑定登录 principal、浏览器随机值、client、10 分钟期限；回调再次验证成员权限。scope 只请求 ads_read；token expiry 使用 Meta 返回值。没有 Meta refresh token，过期/撤销须重新授权。
- API key 复用哈希存储，仅 `meta:ads:read`，30 天期限，绑定一个 grant revision；撤销/重新授权使旧 grant/key 失效。旧 read:all 不自动获得 Meta 工具，免费 key 不能访问旧付费工具。
- 模型中立 Zod input/output contract，八个工具一套 handler；MCP 和 HTTPS 使用同一结果。MCP tools/list 按本次身份构建，无全局目录串用。
- GET-only Graph helper 位于既有 Meta connector 内；不导入混合读写 `meta/client.ts` 或 CAPI writer。实体字段复用 entity-settings 的最小 projection。历史内部 parser 的 messaging/lead heuristic 不适合作为公共 conversion 合同，公共 normaliser 显式定义口径。

## API 与用户入口

`/meta-ads-ai/<clientId>`：必须已登录且属于该客户，免费 self_serve 可用；既有 client layout 在 feature 开启时显示入口。注册/客户成员体系复用现有 ME，未增加第二套注册。

- POST `/api/auth/facebook/ads/connect?client_id=<id>`：同源 session，返回 Meta consent URL；HttpOnly Secure SameSite=Lax browser proof。
- GET `/api/auth/facebook/ads/callback`：消费 state、重验 session/client、兑换 token 和核实权限。错误返回可恢复页面。
- GET/POST `/api/clients/<id>/meta-ads-ai`：session 状态、发现、选择账户、发 key、撤销；控制面审计先行。
- GET `/api/ai-tools/meta/manifest`：Bearer key，授权后的工具 input/output JSON Schema。
- POST `/api/ai-tools/meta/invoke`：`{"tool":"meta_get_insights","arguments":{"account_id":"act_1234567890"}}`；本例仅虚构 ID。
- `/api/mcp/mcp`：既有 Streamable HTTP endpoint；Bearer key。SDK 可能返回 SSE-framed response（无持久 SSE endpoint），客户端应遵循 MCP 协议，而非假设每次 response.json()。

八个工具：meta_list_accounts、meta_get_campaigns、meta_get_adsets、meta_get_ads、meta_get_insights、meta_get_video_insights、meta_get_breakdowns、meta_compare_periods。

## 指标和边界

- 默认广告账户时区最近 7 个完整日；显式日期最多 90 日，不含当天。period comparison 是账户级等长前期比较；比较 campaign/ad 趋势可分别调用相同窗口的 insights。
- CTR=all clicks/impressions（ratio），CPC=spend/clicks，CPM=spend/impressions×1000；CPL=spend/`lead`，conversion_action 必须明确枚举；不把 lead 与 messaging 求和或取 max。
- 固定 attribution：impression report time，7d_click+1d_view；不同 Ads Manager 设置可能不一致，响应自带口径。
- Reach/Frequency 来自整窗 API，不累加每日 reach 或平均每日 frequency。视频返回各 quartile/ThruPlay 计数及对 video starts 的比例。ThruPlay 不是 100% retention 的同义词。
- availability 区分未请求视频、provider 未报告、真实 0。Meta 省略字段可能是不适用、隐私抑制或未报告，不能从缺失本身进一步确定原因；返回 null 和原因范围。
- age/gender/age,gender 白名单，provider 拒绝则明确失败。无 lead PII、targeting/customer audience rule 或任意 Graph fields/URL。
- 每页最多 500 行；cursor 加密且绑定 client/key/grant revision/connection version/tool/query/API version，10 分钟有效。永远不跟随 paging.next URL；只取 after 并重建固定 Graph edge。分页未完 complete=false，不冒充完整排名。
- 账户发现最多 5×100 条；超出时界面明确不完整。普通 tools 每次仅一页，comparison 两个 account-total 请求；总 provider deadline 40 秒、单请求 15 秒、无自动无限重试。
- HTTP/MCP body 流式 24KB；30 次/min/client 的数据库原子预算，MCP envelope 与实际 tool 分别计一次，优先安全（最多约 15 个完整 MCP tool requests/min）；失败闭合。Graph rate errors 返回稳定分类。
- 控制面 `authorized → applied/write_failed` 复用 binding audit；尾审计失败不误标动作失败，保留待核实 receipt 并拒绝成功响应。读请求以 mcp_access_log.id 为 request_id，记录工具/资源/身份/结果分类；不记录 token、cursor、广告明细。
- 授权在 provider 调用前后验证，撤销期间的结果不返回。同步查询不接 Inngest：无广告副作用、无后台接力；receipt 在既有审计表。

## 配置与发布门槛

默认 `META_ADS_AI_ENABLED` 未设 = OFF。`META_ADS_AI_GRAPH_VERSION` 必须由发布验证显式固定受支持版本（例如测试 fixture 用 v21.0；这不是承诺该版本适用于生产）。复用 FACEBOOK_APP_ID、FACEBOOK_APP_SECRET、CMS_TOKEN_ENCRYPTION_KEY、NEXT_PUBLIC_APP_URL（HTTPS）。没有新增依赖。

独立审批后才可执行的顺序：审核 SQL → staging application schema → staging 部署/配置确切 redirect URI → 真实外部账户验证 → 非 Codex 客户端验证/普通用户配置演练 → 公开开启。由于旧 token manager 现在使用 purpose 列，**schema 必须先于代码部署，即使 feature 关闭**。本次仅生成 SQL，没有应用到远程库。

公开发布 blockers：

1. 核实 Meta Business Verification、Marketing API Advanced Access / ads_read App Review、Live mode、privacy/deletion/deauthorisation URLs 与 Data Use Checkup；不能由代码测试推断已获批准。
2. Meta 外部非 app-role 用户 OAuth → account → eight tools → revoke 的实测（含 token 过期/权限撤销和真实归因口径）。
3. 至少一个非 Codex 客户端完成实际连接/读数，补具体客户端配置指引及成功读数反馈；当前 key/manual settings 只能称技术 pilot。不能承诺任意 AI/中国大陆任意网络均即连即用。
4. 现有 repository 全量 type/lint 基线失败需由主线治理处理；本 PR 的受影响文件检查独立报告。

回退：关闭 META_ADS_AI_ENABLED 会停止新连接和新工具；保留新增表及 legacy 默认，不破坏旧连接。撤销只读 connection/key 是本地授权，不调用整个 Meta App 的全球 deauthorisation，避免伤及原 Page 功能。

## 验证记录

- 受影响回归：265 tests / 19 files，通过（包括原 Meta OAuth/Page callback、vault、API keys、MCP、账户ownership以及新44项）。
- 临时独立 PostgreSQL：40 checks，通过；覆盖双向新旧 writer 竞争、两个public tenant、repeatable-read、disconnect/reconsent、nonce、真实RLS/ACL及并发限流。脚本自行创建/销毁本地cluster，不接受数据库 URL。
- 架构/安全/非技术体验两轮独立审查已同意 Draft；安全尾审计 P2 已修复并加断言。独立攻击验证另补记录。
- Jev + CUA 合成组件 smoke：发现账户→选择→连接→生成虚构key→隐藏/撤销，通过；原生 select 接管一次。只验证真实组件+虚构fetch，不是 Meta OAuth 或部署 E2E。Jev本地观察记录已保存。
- 修改范围 ESLint：33 个 TS/TSX 文件通过；新增 policy TO 子句检查、git diff --check 通过。
- Type-check：仅原有 7 项（Messenger test usedAiDraft ×4，workflow-guards WorkflowStep.env ×3）；无新增类型错误。
- `npm run build`：成功（使用明确虚构 Supabase 配置，未提供生产环境文件）；Next 配置本来跳过 type/lint，故分别运行并独立报告。
- 全量 lint：86 个错误；在精确基线 main 的独立 archive 中复跑，同样 86 个、错误行逐条相同。没有隐藏/禁用 lint 规则。
- 关键 mutation：7/7 被测试杀死（account allowlist、explicit scope、post-provider revoke、cursor binding、GET-only、OAuth principal、legacy DB conflict）；每次都恢复原文件。
- 独立攻击 agent：新44 tests及原40 DB checks通过；额外临时探针47项SQL、15项Vitest通过（包含既有测试，不与前述数字累加）。无确认漏洞；不替代真实 provider E2E。
- 最终 commit SHA 以 Draft PR head 为准；所有检查均针对该交付源码，未发布。
