# 🔒 INTERNAL ONLY — FDE 管理员 MCP 钥匙 SOP

> **此文档仅限 ME 内部。绝不外传、绝不出现在任何客户 SOP / 公开文档里。**
> Phase 34 P3 · 管理员超级钥匙(`me_admin_*`)= 跨所有客户读取。一把泄漏 = 全公司客户数据泄漏。

---

## 0. 这是什么

管理员钥匙让 FDE 在自己的 AI(Claude Code / Codex / Desktop)里**跨所有客户**查询数据,不用每个客户配一把。它和客户钥匙(`me_live_*`)**物理隔离**:

| | 客户钥匙 | 管理员钥匙 |
|---|---|---|
| 前缀 | `me_live_` | `me_admin_` |
| 范围 | 单一客户 | **所有客户** |
| 端点 | `/api/mcp/mcp` | `/api/mcp-admin/mcp` |
| 颁发 | 客户设置页 §4 | `/dashboard/admin/mcp-keys`(仅 Admin) |
| 限流 | 60/min | 30/min |
| 过期 | 无 | **强制 ≤180 天,默认 90** |

---

## 1. 颁发流程

1. `/dashboard/admin/mcp-keys` → 填钥匙名(如 `老雷-laptop`)
2. **填 IP 白名单**(强烈建议,见 §4):每行一个 CIDR,如 `203.0.113.0/24`。留空会有红色警告。
3. 点「生成管理员钥匙」→ web 端二次确认弹窗 → 确认
4. **复制弹出的完整钥匙(只显示一次)**,安全交付(不要明文邮件 / 截图整段)
5. 在自己的 AI 客户端配置:
   - **Claude Code**:`claude mcp add --transport http magic-engine-admin https://app.magicengine.com.au/api/mcp-admin/mcp --header "Authorization: Bearer me_admin_..."`
   - **Codex**:`codex mcp add magic-engine-admin --url https://app.magicengine.com.au/api/mcp-admin/mcp --bearer-token-env-var MAGIC_ENGINE_ADMIN_TOKEN`
   - **Claude Desktop**:mcp-remote,URL 用 `/api/mcp-admin/mcp`
6. 工具:`me_admin_list_clients`(列所有客户)+ `me_admin_get_overview(client_id)` / `me_admin_list_goals` / `me_admin_get_seo_performance` / `me_admin_list_execution_items`

> ⚠️ 拿到钥匙后 **24 小时内必须补 IP 白名单**(如首把没填)。空白名单是临时妥协,不是常态。

---

## 2. 🚨 事故响应(钥匙泄漏 / 笔记本被偷)

**目标:60 秒内决策,5 分钟内全部失效。**

### 首选(后台可达):一键吊销全部
1. `/dashboard/admin/mcp-keys` → 顶部红条「紧急吊销全部」
2. 输入 `REVOKE-ALL` 确认
3. 立即生效(无需重启)——所有管理员钥匙下次请求即 401

原理:写 `api_key_settings.admin_revoke_all_before = now()`,`verifyApiKey` 对所有 `created_at <` 该时间的 admin key 一律拒绝。**不依赖逐行 update,不依赖部署。**

### 兜底(ME 后台挂了 / DB 不可达):env kill-switch
1. Render 控制台 → 环境变量 → 设 `ADMIN_KEY_KILL_SWITCH=true`
2. **必须触发 redeploy**(env 改动重启才生效)—— 这是 env 路径的代价,所以它是兜底不是首选
3. 生效后所有 `me_admin_*` 一律 401(DB 层都不查)

### 事后取证(评估爆炸半径)
```sql
-- 怀疑时间点之后,所有管理员钥匙调用了什么、查了哪些客户
SELECT a.owner_email, a.name, l.tool, l.client_id, c.name AS client_name, l.source_ip, l.created_at
FROM mcp_access_log l
JOIN admin_api_keys a ON a.id = l.admin_key_id
LEFT JOIN clients c ON c.id = l.client_id
WHERE l.key_kind = 'admin'
  AND l.created_at > '<怀疑时间>'
ORDER BY l.created_at DESC;
```

### 恢复
- 重发新钥匙(**必须**填 IP 白名单)
- 通知所有 admin
- 复盘:钥匙怎么泄漏的,补流程

---

## 3. 日常审计

```sql
-- 某 owner 最近 7 天的所有跨客户查询
SELECT a.owner_email, l.tool, c.name AS client_name, l.source_ip, l.created_at
FROM mcp_access_log l
JOIN admin_api_keys a ON a.id = l.admin_key_id
LEFT JOIN clients c ON c.id = l.client_id
WHERE l.key_kind = 'admin' AND a.owner_email = '<email>'
  AND l.created_at > now() - interval '7 days'
ORDER BY l.created_at DESC;

-- 即将过期(7 天内)的钥匙(也由 cron /api/cron/admin-key-expiry 每日检测)
SELECT name, owner_email, expires_at FROM admin_api_keys
WHERE revoked_at IS NULL AND expires_at < now() + interval '7 days';

-- 还没补 IP 白名单的钥匙(软启用债)
SELECT name, owner_email, created_at FROM admin_api_keys
WHERE revoked_at IS NULL AND ip_allowlist = '{}';
```

---

## 4. 安全边界(实现层,给后人维护)

- **物理隔离**:`admin-scoped-queries.ts` / `admin-tools.ts` **绝不 import** `scoped-queries.ts`(由 `import-isolation.test.ts` 静态锁,CI 强制)。客户路径与管理员路径在代码层永不交叉。
- **前缀防呆**:DB CHECK 强制 `me_live_%` / `me_admin_%`;`verifyApiKey` 前缀 XOR;`lookupByKind` 单表查询,绝不 UNION。
- **wrong_endpoint**:管理员钥匙打客户端点(或反之)→ `verifyApiKey` 的 `expectedKind` 直接拒(`wrong_endpoint`),DB 零触碰。
- **三层 kill-switch**:DB(权威)+ env(兜底)+ UI(操作)。
- **过期**:SQL 层 `.gte('expires_at', now)` + DB CHECK ≤180 天(应用忘检查 = 0 行)。
- **审计**:`mcp_access_log` 双 FK(`client_key_id` / `admin_key_id`)+ `key_kind` + `source_ip`,三分支 CHECK 保完整性。

---

## 5. 待办(二期 / 后续 PR)

- [ ] 真 colleague-confirm(同事 6 位 code,表 `admin_key_issue_confirms` 已建,只差 API)
- [ ] 过期提醒邮件(等 P2 `notifications/email.ts` + SendGrid;cron 骨架已就位 `/api/cron/admin-key-expiry`)
- [ ] IP 白名单从「软启用」升级到 DB 强约束(非空)
- [ ] wrong_endpoint 高频命中自动拉黑(cron 接 access_log 信号)
- [ ] `createMcpAuthAdapter(kind)` 抽取(两 endpoint verifyToken 防漂移,纯重构)
