---
name: sync-to-me
description: >-
  把 discovery-scan 输出的 3 份 JSON POST 到 ME 后台 /api/discovery/scan-results endpoint ·
  写入 competitor_snapshots / market_context_snapshots / local_media_channels 三张表 · 让
  客户详情页 Discovery tab 看得到。Use when: 用户说「同步进 ME / sync to ME / 灌进后台 /
  推到 ME 数据库」，或者 discovery-scan 用户给了 client_id 后主动引导。前置：ME_API_URL +
  ME_API_TOKEN 环境变量必须存在 · Phase 1 端点上线前本 skill 会打印 stub 提示不真跑。
---

# /sync-to-me — 结果同步到 ME 后台

把本地 discovery-scan 的 JSON 结果推到 ME 后台 · 让客户详情页的 Discovery tab 能看到。

---

## Phase 状态（当前 · 2026-07）

**⚠️ 本 skill 当前是 stub 状态**。

- ME 后台的 `/api/discovery/scan-results` endpoint **尚未上线**（Phase 1 计划）
- `competitor_snapshots` / `market_context_snapshots` / `local_media_channels` 3 张表**尚未建**
- 本 skill 目前功能：**校验数据是否符合 schema + 干跑打印 payload · 不真的 POST**

Phase 1 上线后（下月），本 skill 会解锁真实 POST · 用户届时**不需要改配置**，只要环境变量设好就自动走真管道。

---

## 前置条件

- [ ] `/discovery-scan` 已跑，本地有 JSON 输出
- [ ] `ME_API_URL` 环境变量已设（如 `https://magicengine.com.au` 或 dev 环境）
- [ ] `ME_API_TOKEN` 环境变量已设（Bearer token · 从 ME 后台生成）
- [ ] `client_id` 已在 discovery-scan 阶段 Q6 输入 或本次显式提供
  - 若未在 ME 后台建过客户 → **不能同步** · 请先 ME 后台建客户拿到 UUID
- [ ] `me-client-discovery` 插件版本 ≥ 上线版本（由 plugin.json 判断）

---

## 执行流程

### 1. 定位输入

- 用户给了 slug + client_id → 找 `docs/clients/{slug}/discovery/{latest-date}/manifest.json`
- 校验 manifest.json 中 `client.id` 与用户给的 client_id 是否一致 · 不一致 → 抛错让用户澄清

### 2. Schema 校验

对每份 JSON 跑 schema 校验：
- `schemas/competitor-snapshot.schema.json`
- `schemas/market-context.schema.json`
- `schemas/local-media-channel.schema.json`

**校验失败**：
- 显示第一处失败字段 + 期望格式 + 实际值
- 建议用户改 `discovery-scan` 输出或手动补齐
- 不 POST

### 3. 干跑模式（Phase 0 · 当前）

由于 ME endpoint 尚未上线：
```
[STUB · Phase 1 endpoint 未上线]
若已上线，本次会 POST 以下 payload：

POST {ME_API_URL}/api/discovery/scan-results
Authorization: Bearer {ME_API_TOKEN}
Content-Type: application/json

Body: {
  "client_id": "...",
  "scanned_at": "...",
  "source": "plugin_manual",
  "competitors": [...],       ← {N} snapshots
  "market_context": {...},
  "local_media_channels": [...] ← {M} channels
}

payload 大小：{XX} KB
校验：所有 schema 通过 ✅

✅ 本地 JSON 已保留 · Phase 1 endpoint 上线后跑本命令即可真提交。
```

### 4. 真跑模式（Phase 1 · 下月）

```
POST 到 {ME_API_URL}/api/discovery/scan-results
Response: 200 OK · 写入 {N} competitor_snapshots · 1 market_context_snapshot · {M} local_media_channels
客户详情页 Discovery tab URL：{ME_API_URL}/dashboard/clients/{client_id}/discovery
```

失败处理：
- 401 → token 失效 · 提示用户重新生成
- 404 → client_id 无效 · 让用户核对
- 5xx → ME 后台错误 · 保留本地 JSON · 建议稍后重试
- 网络错误 → 保留本地 JSON · 打印重试命令

### 5. 幂等性

同一份 discovery-scan 结果重复 POST 应该幂等 · Phase 1 endpoint 会用 (`client_id` + `scanned_at`) 复合键做 upsert。

---

## ME 后台 endpoint spec（Phase 1 实现清单 · 给未来子牙看）

```
POST /api/discovery/scan-results
Authorization: Bearer <token>
Content-Type: application/json

Body:
{
  "client_id": UUID,
  "scanned_at": ISO 8601,
  "source": "plugin_manual" | "simatai_auto" | "manual_import",
  "competitors": [CompetitorSnapshot],
  "market_context": MarketContextSnapshot | null,
  "local_media_channels": [LocalMediaChannel]
}

Response 200:
{
  "written": {
    "competitor_snapshots": N,
    "market_context_snapshots": 1 | 0,
    "local_media_channels": M
  },
  "discovery_tab_url": "/dashboard/clients/{id}/discovery"
}
```

后端实现（Phase 1 子牙拍板）：
- 走 supabaseAdmin service-role（CLAUDE.md 强约束）
- 校验：token → 客户 owner 或 admin 才允许写
- 表 RLS：service_role_full 模板（CLAUDE.md 强约束）
- upsert 主键：(`client_id`, `scanned_at`, `competitor_name`) 或 (`client_id`, `scanned_at`) 视表而定

## 未来 ME 兼容

Phase 3 后，司马徽 agent 自动化跑 discovery 时用相同 endpoint · `source` 字段区分是 plugin 还是 simatai 写的 · 客户详情页 UI 展示 badge 提示"手工版 vs 自动版"。
