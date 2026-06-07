# Magic Engine MCP — 二期产品设计(场景 B 推送 + Admin Key + 写入)

> **状态**:设计稿 v1 · 2026-06-05 · 续接 Phase 34(已 merge to main,#369/#380)
> **范围**:**只覆盖 Phase 34 核心之外的增量**,不重写已上线部分。
> **路径选择**:文档放 `docs/specs/`(沿用 ME 现有体系),不开 `docs/superpowers/` 平行树。

---

## 0. 边界声明(避免重叠)

Phase 34 已经做完并上线的部分,本文档**不再讨论**:

| 已上线(#369/#380) | 出处 |
|---|---|
| Per-client API Key 鉴权(`me_live_xxx`,sha256 存 hash) | `src/lib/auth/api-key-access.ts` |
| 5 个只读工具(overview / list_goals / goal_detail / seo_performance / list_execution_items) | `src/lib/mcp/tools.ts` |
| Scoped-queries 最里层 client_id 隔离(闭包绑定 + 强制 `.eq`) | `src/lib/mcp/scoped-queries.ts` |
| FDE 后台发/吊销 Key UI(设置页 §4) | `_components/ApiKeysPanel.tsx` |
| 限流(60/min,`mcp_access_log` 滑动窗) | `src/lib/mcp/rate-limit.ts` |
| 封装名过滤 + 客户接入 SOP | `src/lib/mcp/vendor-filter.ts` · `docs/sops/mcp-ai-assistant-connect.md` |

**「Key 撤销机制」也已完成(P34.2 软删除 + UI)**,不在本文档新工作里。

---

## 1. 用户与场景

### 1.1 用户
- **FDE 团队**(内部,跨客户视角)
- **MTC 付费客户**(澳新商家,单租户只读)

### 1.2 场景
- **A. 被动查询**(客户问 Claude → Claude 调 MCP → 答) — ✅ Phase 34 已支持,**本文档不重做**。
- **B. 主动推送 / 周期简报**(邮件周报 + 客户打开 Claude 的「迎接式简报」) — **新**。

### 1.3 渠道
- 邮件(SendGrid) — **新**
- Claude 迎接式简报(prompt + 已有工具,文档/SOP 级) — **新但零代码**
- 微信:暂不做

### 1.4 上手方式
- 首批:FDE 帮配(已支持) — ✅
- 未来:客户自助 UI(暂不在本期范围,延后)

---

## 2. 优先级矩阵(剔除已完成)

| 阶段 | 任务 | 状态 |
|------|------|------|
| **P0** 现在 | FDE 帮首批客户配 MCP(已具备能力,本期产出 = 一次内部演练 + 一份「迎接式简报」prompt 模板) | 🟢 文档/SOP |
| **P1** 本周 | (a) `clients.notification_email` 字段 + 后台 UI;(b) SendGrid 客户端封装 + ENV;(c) MTC 上线前的 Key 安全自检清单 | 🟡 后端 + 极小 UI |
| **P2** 下周 | (a) 简报渲染模板(基于 Phase 34 已有工具组装);(b) 周报 cron(GitHub Actions);(c) `me_list_execution_items` 分页(limit/offset)| 🟡 中等 |
| **P3** 月内 | FDE admin key(跨客户查询) — **触碰 Phase 34 核心隔离不变量,需特别安全审** | 🔴 高敏感 |
| **P4** 季内 | 写入工具(Goal → Initiative → Kanban) — 见 Phase 34 设计稿 §12「可执行 V2 路线」,本文档不展开 | 🔴 战略级 |

> Phase 34 设计稿(`docs/specs/me-mcp-server-design.md`)§12 已为 P4 留好命名空间(`me_execute_*`)与 scope(`write:*`),零返工。

---

## 3. P0 — FDE 帮首批客户配 + 迎接式简报演示(现在,零代码)

**目的**:把已上线的能力**真用起来**,而不是停在「能跑」。

**交付物**(纯文档,本 PR 内可一并产出或后续小 PR):

1. **首批客户清单**(PM 确认):建议 CTS Tours + Oztop + 1 个愿意试的 MTC 客户。
2. **「迎接式简报」prompt 模板**(用户在 Claude 里贴一次,以后只需说「跑一下简报」):
   ```
   你是我的 Magic Engine 商业助手。当我说「跑简报」时:
   1) 调 me_get_overview,提取总分 + 6 维度
   2) 调 me_list_goals('active'),列出每个 Goal 的 baseline / current / target / verdict
   3) 调 me_get_seo_performance({limit:3}),取近 3 期 clicks/impressions/avg_position 趋势
   4) 调 me_list_execution_items,统计每维度 pending / in_progress 数,各举 1 个最关键任务
   输出格式:开头一句话健康总览 → 三栏指标(SEO / Goals / 执行) → 3 条「下周该做」建议。
   语气:简洁、商业、AU/NZ 口吻。
   ```
3. **首次演练 SOP**:FDE 上门(或视频)演示 → 客户问「跑简报」→ 现场感受。

**为什么放 P0**:已有能力 + 一份 prompt = 立刻能感受「最懂你的 AI 商业助手」叙事,不写代码、不延后,直接落地价值。

---

## 4. P1 — 推送地基(本周)

### 4.1 `clients.notification_email` + 后台 UI

**Migration**:
```sql
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notification_email text;
COMMENT ON COLUMN public.clients.notification_email IS
  '客户接收 MCP 周报 / 系统通知的邮箱。NULL = 不发。允许与 client_portal_users.email 不同(老板邮箱 vs 操作邮箱)。';
```

**UI**(强约束:配置类必须有 UI):设置页 §4 程序化访问下方新增一个「📧 通知邮箱」小卡(复用 chip+input 模板,跟 BrandAliasesPanel 一样的形)。

### 4.2 SendGrid 封装

新增 `src/lib/notifications/email.ts`:
- 单一导出 `sendEmail({to, subject, html, replyTo?})`,内部封装 SendGrid SDK
- 必须 env vars:`SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL` / `SENDGRID_FROM_NAME`(Render 配)
- 失败:`.catch()` 静默不阻塞(沿用 ME 既有 fire-and-forget 哲学);写一行 `notification_log` 表(P1.4 顺手建)留审计

### 4.3 `notification_log` 表
```sql
CREATE TABLE notification_log (
  id uuid PK default gen_random_uuid(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  channel text NOT NULL,  -- 'email' / future 'wechat'
  template text NOT NULL, -- 'weekly_brief' / 'onboarding' / ...
  to_address text,
  subject text,
  ok boolean NOT NULL,
  error_code text,
  sent_at timestamptz default now()
);
-- RLS: service_role 模板(CLAUDE.md 强约束)
```

### 4.4 MTC 上线前 Key 安全自检清单(无新代码,文档级)
- [ ] Key 已是 hash-only(✅)
- [ ] 吊销链路通(✅ Phase 34)
- [ ] 限流上线(✅ 60/min)
- [ ] 跨租户隔离亲验(✅ 狄仁杰 + CTS Claude Desktop 真机验过)
- [ ] **未做**:Key 自动轮换 / 过期时间 — **决策**:MVP 不做,文档里告知 FDE「客户离职/告警时手动吊销重发」即可,等出现规模才上自动轮换

---

## 5. P2 — 周报 + 分页(下周)

### 5.1 简报渲染模板
- 位置:`src/lib/notifications/templates/weekly-brief.tsx`(用 React Email 或字符串模板,看 ME 现有体系)
- 输入:`client_id`
- 流程:**复用 Phase 34 scoped-queries**(不重写查询逻辑),只是从「序列化给 Claude」改为「渲染成 HTML 邮件」
- 输出 HTML 含:总分 + 6 维度小红点 / Goal 列表带进度条 / 近 3 期 SEO 趋势 / 5 条「本周该做」

### 5.2 周报 cron(GitHub Actions,沿用 ME 现有 cron 体系)
- `.github/workflows/mcp-weekly-brief.yml`:每周一 07:00 NZST → 调 `POST /api/cron/weekly-brief` 带 `CRON_SECRET`
- 路由:`src/app/api/cron/weekly-brief/route.ts` → 遍历 `clients WHERE notification_email IS NOT NULL` → 串行调 `renderWeeklyBrief(clientId)` + `sendEmail()`

### 5.3 `me_list_execution_items` 分页
- 入参加 `{ limit?: number = 50, offset?: number = 0 }`,upper bound 200
- 返回结构改为 `{ items_by_dimension, total, has_more }`(向后兼容老调用方,因为现在还没真实老调用方)
- scoped-queries 层加 `.range(offset, offset+limit-1)`

---

## 6. P3 — FDE Admin Key ✅ 已实施完成(PR #391 merged 2026-06-05)

> 📌 **本节已落地** —— 完整设计 + 实施记录见 ROADMAP 「Phase 34 二期 P3」段 + 内部 SOP `docs/sops/admin-mcp-key-internal.md`。
> 走完整 Agent 审查协议:子牙出方案 → 魏征 2 审挑刺 → 子牙修订(加 Z1/Z2) → 魏征复审 Open the gate → 8 commit 实施 → 狄仁杰断案「隔离命门守住,准予 merge」。
>
> 本节以下原始设计要点仅作历史记录保留,真实实施细节以 main 上代码 + SOP 为准。

> ⚠️ **本节是整个二期最危险的一环**。Phase 34 的安全护城河就是「client_id 双层锁定 + 一把 key 只能看一家」。Admin key 要打破这个不变量,必须**特别小心、单独设计、双审**。

### 6.1 不变量再陈述
- **绝不在 `scoped-queries` 层加旁路**(那是最里层,旁路 = 整套体系崩塌)
- 改为**独立增加 `admin-scoped-queries.ts` + `admin-tools.ts`**,只在 admin key 才注册
- Admin 工具的查询函数**显式接受 `client_id` 参数**(因为它本来就是跨客户),且工具描述必须写明「跨客户,仅 FDE」

### 6.2 鉴权扩展
- `client_api_keys.scopes` 当前默认 `['read:all']`,新增 `'admin:read:all'`
- `verifyApiKey` 不变,工具注册时按 scope 分叉:`registerReadOnlyTools` vs `registerAdminTools`
- **必须**给 admin key 一组额外约束:`metadata.ip_allowlist` 可选、`expires_at` 必填(强制 90 天)、`mcp_access_log` 加 `is_admin boolean` 列以便后期审计区分

### 6.3 Admin 工具集(MVP 5 个 → P4 才考虑加更多)
- `me_admin_list_clients` — 返回所有客户的简表(id / name / domain)
- `me_admin_get_overview(client_id)` — 跨客户调 P34 既有 getOverview
- `me_admin_list_goals(client_id, status?)` — 同上
- `me_admin_get_seo_performance(client_id, limit?)` — 同上
- `me_admin_list_execution_items(client_id)` — 同上

> **写入 admin 工具** 不在 P3,留 P4 一起规划(防呆:admin key 现阶段仍只读,即便写工具上线,admin scope 不自动含 write)。

### 6.4 必做的双审
- **魏征**:审 admin scope 边界、verifyApiKey 分叉、`mcp_access_log` 区分字段、IP 白名单与过期是否真生效
- **狄仁杰**:断案式攻击 — 用 admin key 调普通工具是否串号、用普通 key 调 admin 工具是否被拒、过期 key 是否真过期

---

## 7. P4 — 写入工具(季内,本文档不展开)

完整设计已在 Phase 34 设计稿 `docs/specs/me-mcp-server-design.md` **§12「V2 路线:从只读透明度到可执行飞轮触发源」** 写明:
- 命名空间 `me_execute_*` 已预留
- Scope `write:*` 已预留
- 审批链 / `flywheel_actions` 归因 / 「Fix vs Talk to Us」红线 — 那一节已经分析过

二期不展开,P4 启动时直接续接 §12。

---

## 8. PM 决策(2026-06-05 拍板,经魏征 + 板桥筛后只问了商业项)

> 流程:6 个待决项先过魏征(技术 vs 商业筛选）+ 板桥(非技术 PM 视角通俗化)。
> 结果:只把 3 个真·商业决策问 PM,其余 4 个技术项 Claude Code 自定默认值。

**PM 拍板的 3 项**:
1. **首批客户**:✅ **只用 CTS + Oztop**(不加第三家付费客户）—— 最稳的小范围试点。
2. **周报频率**:✅ **周一 + 周五各一封**。
   - ⚠️ 提示(尊重决定，仅记录风险):双周报信息较密，试点期需盯**退订/已读率**；若客户嫌烦，降回「周一一封 + 周五 ad-hoc」。这条进 P2 的观察指标。
3. **「下周该做 5 条建议」把关**:✅ **先生成 → FDE 人审 → 再发**（不直接自动发）。
   - 落地:建议生成走「规则兜底 + AI 润色」混合，**但出口必须经 FDE 一眼确认**才发客户。简报渲染加一个 `pending_review → approved → sent` 状态机。

**Claude Code 自定的 4 项技术默认**(PM 无需关心):
4. ~~Admin key IP 白名单~~ → **不做**（FDE 移动办公 IP 不固定，加了自锁；用 token + 审计日志 + 90 天过期兜底）。
5. ~~notification_email 验证~~ → **做基础格式校验 + 发送失败回流告警**，不做双重确认邮件（FDE 帮填，自助阶段再补）。
6. ~~建议规则 vs AI~~ → 见上 §8.3，混合方案 + 人审出口。
7. ~~子牙何时排期~~ → Claude Code 工作流编排，PM 批准本文档后即出 P1+P2 计划。

---

## 9. 与 ROADMAP 的关系

ROADMAP 的 Phase 34 状态行已在 #380 更新为「全部完成 + 二期主推方向」。本文档**不再修改 ROADMAP**(防多 session 撞 ROADMAP)—— 等 PM 批准本设计后,**单独一个小 PR 把 P0–P4 任务追加到 Phase 34 二期 backlog**,follow ROADMAP diff 自查强约束。

---

## 10. 下一步(给子牙的输入)

PM 批准本文档后,**子牙基于本文档出实现计划**,但**仅覆盖 P1 + P2**(本周 + 下周可落地)。P3 admin key 触碰安全核心,单独写一份设计文档再上子牙;P4 直接续接 §12,届时再说。

---

**一句话总结**:Phase 34 核心已上线,本文档把另一对话的决策汇总 **去重 + 续接 + 加上对已上线的引用**,真正新工作 = 推送链路 + 分页 + admin key + 写入。从 P0 现在就能动(零代码做演示),P1/P2 一周内完成推送 MVP,P3 月内补 admin key(需安全双审),P4 留 Phase 34 §12 已规划路线。
