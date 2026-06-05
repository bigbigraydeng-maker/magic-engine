# P34.1 — MCP Bearer Auth Layer (implementation notes)

> 日期：2026-06-05 NZST · 分支 `claude/magic-engine-mcp-design-GJNWq` · PR [#369](https://github.com/bigbigraydeng-maker/magic-engine/pull/369)

## 落地清单

| 项 | 文件/位置 | 验证 |
|---|---|---|
| migration | `supabase/migrations/20260627000001_p34_mcp_api_keys.sql` | apply 进 CrazyContent (`glbdnayojixmexgofbsd`)，两表 RLS on + 1 service_role policy + 4/3 索引 |
| 鉴权 lib | `src/lib/auth/api-key-access.ts` | 25/25 vitest 通过（generate/sha256/extractBearer/verifyApiKey 全路径 + logMcpAccess） |
| 路由挂载 | `src/app/api/mcp/[transport]/route.ts` | `withMcpAuth(baseHandler, verifyToken, { required: true })`；`me_ping` 工具读 `authInfo.extra.meClientId` 并写 `mcp_access_log` |
| 生产 build | `npm run build` | ✓ Compiled successfully；路由清单含 `/api/mcp/[transport]` |

## Key 格式

- 明文：`me_live_<base32 random 64 chars>` (≈160 bits entropy)
- 字母表：Crockford-style base32（无 I/L/O/U，避免 OCR/手抄歧义）
- 入库：`key_hash = sha256(plaintext)`，`key_prefix = plaintext[:12]`（UI 显示用）
- 明文**只在创建时返回一次**，吊销走 `revoked_at` 软删除

## 安全不变量（已落实）

1. ✅ 客户端**只能通过 `Authorization: Bearer me_live_…`** 访问 `/api/mcp/*`，不带 → 401
2. ✅ `client_id` 从 key 反查得到，**绝不接受工具入参**（外层不变量，设计文档 §6.1）
3. ✅ `withMcpAuth` 透传 `AuthInfo`：`extra.meClientId` = ME 客户 id，`extra.keyId` = key uuid（注意 `AuthInfo.clientId` 是 OAuth 概念，**不是** ME client_id —— 故意分开）
4. ✅ DB 查询 `.is('revoked_at', null)` 过滤吊销 key
5. ✅ 单测有「**查询用 hash、绝不送明文进 DB**」断言（变异测试雏形）
6. ⏳ 最里层不变量（scoped-queries 闭包绑定）待 P34.4 落地

## 端到端 HTTP 验证（推迟到 CF 预览部署或 P34.4 联测）

**为什么本次没在本地跑：** dev 容器缺 `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`，`src/lib/supabase.ts` 顶层 throw，dev server 起来但 `/api/mcp/*` 直接 500。这是环境配置问题，跟 MCP 代码无关。

**未来怎么补：** Cloudflare Pages 预览部署有完整生产 env（之前 spike build 已验证）。在 PR #369 任一预览 URL 上跑：

```bash
# 1) 给某个 QA 客户在 DB 插一把 key（FDE UI 是 P34.2 的事，现在手动）
#    Supabase MCP 用 generateApiKey() 生成 plaintext/hash/prefix；
#    INSERT 进 client_api_keys，关联 client_id 为 QA 客户。
#
# 2) 三场景验证（用 `.mcp-auth-check.mjs` 同款脚本）：
#    - 不带 Authorization     → 期望 401
#    - 带假 Bearer me_live_x  → 期望 401
#    - 带真 Bearer            → tools/list 含 me_ping + tools/call 返回 pong
# 3) 验证 mcp_access_log 多了一行（key_id / client_id / tool='me_ping' / ok=true）
# 4) 测试结束立即 revoke：UPDATE client_api_keys SET revoked_at = now() WHERE id = ...
```

本地 dev 实测要做的话：把 Render 的 `NEXT_PUBLIC_SUPABASE_URL` / `*_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 复制进 `.env.local`（已在 `.gitignore`），然后 `npm run dev` → 走上面同样的脚本。

## 本次留下的清理痕迹

- ✅ 测试 key（id `9880986a-0bd7-4b4b-894a-4336da0bd3f6`，QA CTS `aaaaaaaa-…`，name 'P34.1 spike test key'）已 `revoked_at = now()` —— 行还在，作为 P34.1 的「曾被发出的第一把 key」审计证据
- ✅ 临时 `.mcp-spike-check.mjs` / `.mcp-auth-check.mjs` 删除
- ✅ `.gitignore` 加 `.mcp-*.mjs` 兜底，防未来同款临时脚本被误提交
