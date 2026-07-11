# me-client-discovery

Magic Engine · **DAPE-Discovery 段的手工前身**。新客户接入第一周用 · 派并行分身扫竞对 / 市场 / 本地媒体，出中文 HTML 提案 deck，可选部署到 Cloudflare Pages。

Roman Hu 案例（2026-07-10）首次跑通 · 沉淀成本插件。

---

## 5 个 skill

| Skill | 触发 | 干什么 |
|---|---|---|
| `/discovery-scan` | 新客户第一周 | 派 6-8 分身并行调研 · 出 3 份结构化 JSON |
| `/synthesize-deck` | discovery-scan 之后 | JSON → 中文 HTML 提案 deck |
| `/deploy-deck` | deck 生成之后 | 部署 Cloudflare Pages · 拿分享链接 |
| `/sync-to-me` | 有 client_id 时 | 把 JSON POST 进 ME 后台 3 张表（Phase 1 后解锁）|
| `/sanity-check` | 输出前 QA | 查编数字 / 未标不确定 / 跨地理搬案例 / 短板遗漏 |

---

## 快速开始（Claude Code 里）

```bash
# 1. clone / 已装 · 用户 ME repo 已包含
# 2. 触发 discovery
用户输入："给客户 Roman Hu 跑 discovery，他是华人房产中介
         在 Ray White Mission Bay，主打 Bayside + Central Gold，
         对手是 Aaron Foss / Paul Neshausen / Lawrence Yuan / Sarah Liu"
Claude 自动加载 /discovery-scan skill → 派 6-8 分身 → ~5-10 分钟拿结果

# 3. 输出 deck
用户："出 deck"
Claude 自动加载 /synthesize-deck → 生成 docs/clients/roman-hu/deck/2026-07-11/index.html

# 4. QA 检查
用户："跑 sanity check"
Claude 加载 /sanity-check → 报告 red/yellow flag → 修完再跑

# 5. 部署
用户："部署 deck"
Claude 加载 /deploy-deck → npx wrangler pages deploy → 返回 https://roman-hu-plan.pages.dev
```

---

## 快速开始（Claude Cowork 里 · 澳洲同事视角）

1. Admin（PM · 你）把 `plugins/me-client-discovery/` 打包成 `.plugin` 文件
2. Cowork workspace → Install plugin
3. 同事在 Cowork 里输入客户信息 → 一键触发 skill
4. Deck 落到 Cowork 共享 workspace outputs 目录
5. 部署权限锁 admin（避免同事本机 wrangler 配置麻烦）· 同事出 deck HTML · admin 帮 deploy

**详细分工方案**：见 `../docs/FUTURE-ME-COMPAT.md` · Phase 2 后 deploy 走 ME 后台统一管道，不再需要本地 wrangler。

---

## 已知限制（用户跑之前必知）

- **Meta Ad Library 是 SPA 反爬** · WebFetch 拿不到详情 · plugin 会明标"需人工 15 秒核"
- **LinkedIn HTTP 999** · 只能拿 Google 快照
- **RateMyAgent HTTP 403** · 只能拿分数字
- **IG / FB 精确粉丝需登录** · 未登录只能标"存在 + 大致量级"
- **Ahrefs / Similarweb / Apollo MCP** 需 OAuth 授权（非交互 session 不可用）· 授权后重跑
- **WebSearch 可能有区域限制** · 澳洲 IP 可能受限 · 退化用 WebFetch

---

## 未来 ME 系统兼容

参见 `docs/FUTURE-ME-COMPAT.md`。**四阶段路线**：

- **Phase 0（今天）**：Plugin 独立跑 · JSON 落本地
- **Phase 1（下月）**：ME 加 3 张表 + API endpoint · Plugin 可选 sync
- **Phase 2（Week 4+）**：客户详情页 Discovery tab 直接读同表
- **Phase 3（Q1 2027 后）**：司马徽 agent 自动化跑同流程 · 写同表

**Schema 一次定死 · 三处（Plugin / API / 司马徽）零改动无缝接管**。

---

## 关联文档

- SOP · [`docs/sops/client-discovery-scan.md`](../../docs/sops/client-discovery-scan.md) — 手工版流程（同事无 plugin 也能照做）
- DAPE spec · [`docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md`](../../docs/superpowers/specs/2026-06-08-me-dape-redefine-v0.2.md)
- Roman Hu 案例（首次验证） · [`public/decks/roman-hu-plan/`](../../public/decks/roman-hu-plan/)
- CLAUDE.md 硬约束（本插件全部遵守）· [`CLAUDE.md`](../../CLAUDE.md)

---

## 版本

- `0.1.0` · 2026-07-11 · 首版 · Roman Hu 案例沉淀
