# 每日待办邮件 href 落地页 · 能不能真解决问题 · 审计报告

**日期**：2026-09-07
**范围**：`src/lib/pm-todo/**` 里所有下发给 PM 的 `href`，26 条不重复 URL
**执行方式**：Ray 自己的 Chrome（已登录 app.magicengine.com.au / Render / GitHub），我用 Claude in Chrome MCP 逐条实测抓 metadata + 关键页面截图
**判据**：落地页里有没有能**直接触发解决这个 kind 描述的动作**的按钮/表单/链接

---

## 一、总览

| verdict | 条数 | 说明 |
|---|---|---|
| ✅ 落地页真能干活 | 14 | 内部落地页 UI 或外部页面就是正确目的地 |
| ⚠️ 部分能干，但落地或路径别扭 | 5 | 得多绕一步、需要额外知识、SPA 首次载入慢 |
| ❌ 落地跟能力完全错位 / 直接失效 | 5 | 404、query param 被忽略、相对路径被链接闸丢掉 |
| 🟡 未实测（有理由） | 2 | OAuth flow 不能真跑；Ads Manager 深链没有用真实账户/广告组 ID 验证过 |

---

## 二、逐条判定表

### ✅ 落地页真能干活（14）

| kind | 落地页 | 一句话 |
|---|---|---|
| `not_indexed` | [/site-audit/pages?filter=not-indexed](../../src/lib/pm-todo/manual-items.ts#L293) | h1「页面清单」，「未收录(4)」筛选生效 |
| `meta_stuck` / `mailchimp_export_broken` / GBP setup | [/settings](../../src/lib/pm-todo/manual-items.ts#L520) | h1「客户配置中心」，5 个 tab 可切换 + 保存按钮 |
| `price_claim_unbacked` | [/assets](../../src/lib/pm-todo/manual-items.ts#L1044) | h1「素材库」，48 全部/47 已分析等筛选（改单张素材「来源」要多一步点开，仍算可干） |
| `goal_baseline_mismatch` / `leads_metric_untrusted` | [/goal/{goalId}](../../src/lib/pm-todo/manual-items.ts#L1100) | h1 = 目标标题 + BETA + EXPIRED；有「Submit Verdict」按钮 |
| `linkedin_progress_needs_review` | [/content-factory](../../src/lib/pm-todo/manual-items.ts#L1105) | h1「内容工厂」，draft 列表可批准 |
| `dnc_maybe_wrong` / `dm_maybe_stop` / `email_reply_due` (focused) | [/crm/all?contact={id}](../../src/lib/pm-todo/manual-items.ts#L1453) | `?contact=` 生效自动展开到人；「记一笔」按钮在 |
| `email_reply_due` (client-level) | [/crm/all](../../src/lib/pm-todo/email-reply-items.ts#L64) | 全部客人 tab 视图 |
| `cross_client_leak` | [/dashboard/clients](../../src/lib/pm-todo/manual-items.ts#L1545) | 33 客户列表，可点进设置纠正归属 |
| 7 个 kind → `/execution` | [/execution](../../src/lib/pm-todo/manual-items.ts#L1821) | 执行看板：AI 推荐 3 件 + Key Signals + 5 Campaign 上下文 + 44/3/56 分栏 |
| `platform_candidate_review_due` | [platform-candidates.md](../registry/platform-candidates.md) | 直达候选登记表 |
| `blog_pr_open` | GitHub PR URL | 直达 PR，Merge 按钮就在 |
| `cron_not_running` (github) | github/actions | 直达 Actions 页 |
| `paid_signal_needs_review` | mailchimp/audience | 直达 audience（需登录，未登录跳 login） |
| `video_credits_out` | muapi.ai/topup | 直达充值页 |
| `dataforseo_credits_out` | app.dataforseo.com | 直达 DataForSEO 后台 |
| `comment_token_invalid` / `comment_scope_missing` | Graph Explorer | 直达 Meta 图谱 API 探索工具 |
| `cron_not_running` (render/external) / `cron_stuck` / `cron_blind` / `attribution_audit_failed` / `client_list_unreadable` | dashboard.render.com | 直达 Render Overview |
| `cron_not_running` (inngest) | app.inngest.com | 直达 Inngest Dashboard |

### ⚠️ 部分能干，但落地或路径别扭（5）

| kind | 落地页 | 具体问题 | 建议 |
|---|---|---|---|
| `linkedin_progress_needs_setup` / `linkedin_progress_failed` | `/connectors/publer` 服务端 302 到 `/settings?tab=connect` | 邮件说的「Publer 连接器页」不存在独立 URL；落地在 settings 的「接通」tab 里能找到「🚀 Publer 发布器」卡但被夹在 10+ 个其他 connector 中间 | 要么真做一个 `/connectors/publer` 独立页，要么把 how 改成「打开链接 → 拉到最下面找『Publer 发布器』卡」 |
| `price_claim_unbacked` | `/assets` | 落地是素材库总览，PM 要自己筛/搜到那张有问题的图才能改来源 | href 加 `?post={id}` 或 `?highlight={assetId}` 直接高亮到那张图 |
| `factory_worker_idle` | `/dashboard/factory` | 驾驶舱能看队列，但 how 明确说「去 Mac 上跑 CLI 命令」，落地页 UI 里没「启动 worker」按钮 | 落地页加一个「远程启动本地 worker」按钮（或至少显示「这台机器上 worker 状态」） |
| `linkedin_content_factory` 首次载入 | `/content-factory` | SPA 首次载入需要 5-7 秒，前 3 秒页面近乎空白（跟其他重 SPA 页面一致，不是 unique） | 加 loading 骨架屏 |
| 所有 `/execution` 家族 (7 kind) 首次载入 | `/execution` | SPA 首次载入 5-7 秒空白（PM 3 秒内以为坏了会回退） | 加 loading 骨架屏，同上 |

### ❌ 落地跟能力完全错位 / 直接失效（5）

| kind | 落地页 | 严重程度 | 具体证据 | 修法 |
|---|---|---|---|---|
| `crawl_stale` | [/site-audit](../../src/lib/pm-todo/manual-items.ts#L540) | 🔴 P1 | HTTP 200 body 是 **404 页面**（Next.js 404） | 要么改 href 到 `/site-audit/pages`，要么在这个路径真做一个 site-audit 首页 |
| `conversion_needs_review` | [/conversions?client={id}&focus={outcomeId}](../../src/lib/pm-todo/conversion-review-items.ts#L104) | 🔴 P1 | `client=` 和 `focus=` query param **完全被忽略**；页面 bodyLen 只 557 字符 = 空白 + 1 个「客户 ID」输入框 + 2 个按钮。PM 从邮件点进来看到空白，要自己复制 UUID 到框里 | 落地页读 `client=` 自动填入、`focus=` 自动定位到那条 outcome |
| `conversion_send_in_doubt` | [/conversions?client={id}&status=in_doubt](../../src/lib/pm-todo/conversion-review-items.ts#L133) | 🔴 P1 | 同上，`status=in_doubt` 也被忽略 | 同上 |
| `blog_draft_waiting` (有 2 个 href 变体) | 相对路径 `/dashboard/clients/{id}/blog` 或 `/settings` | 🔴 P0 静默丢失 | [action-link.ts:69-83](../../src/lib/pm-todo/action-link.ts#L69) 的 `verifyActionLink` 对相对路径走 `new URL('/xxx')` throws → 落到 `fetch` throws → 返回 `{kind:'broken'}` → [dropBrokenLinks](../../src/lib/pm-todo/manual-items.ts#L202) 判 broken 就 drop（`blog_draft_waiting` 不在 `NEVER_DROP_KINDS` 里，只有 `cross_client_leak` 是）→ **整条待办被 console.warn 丢掉，PM 邮件里根本看不到** | href 改绝对路径 `https://app.magicengine.com.au/dashboard/clients/{id}/blog` |

**⚠️ 关键：`blog_draft_waiting` 这条同一个 bug 早在 [manual-items.ts:1540-1544](../../src/lib/pm-todo/manual-items.ts#L1540) 的 `cross_client_leak` 注释里被明确记录过**（狄仁杰 2026-08-05 kept=0 事故），当时的修法是「加进 NEVER_DROP_KINDS」和「改绝对路径」——`blog_draft_waiting` 两条路径都没做，漏网了。

**⚠️ conversions 两条同样是 blog_draft_waiting 家族的 bug**：href 也是相对路径 `/dashboard/conversions?...`，也会被 dropBrokenLinks 静默丢掉。**除了 query param 不生效之外，这两条根本进不了待办邮件**。

### 🟡 未实测（2）

| kind | 落地页 | 理由 |
|---|---|---|
| GBP setup: needs-connect | `/api/auth/google/connect?client_id={id}` | 会真启动 Google OAuth flow，禁跑。功能上：点了就开始授权，无 UI 可 audit |
| `ad_readback_blocker` | `https://adsmanager.facebook.com/adsmanager/manage/adsets?act={adAccountId}&selected_adset_ids={adSetId}` | 只核对了域名是 adsmanager.facebook.com，没有用真实广告账户 ID 和 adset ID 验证过账户权限、`selected_adset_ids` 参数是否真的把 PM 带到目标广告组——这正是判据要求的「直接触发解决 kind 的动作」，仅查域名不满足，之前误标 ✅ 已改判为未实测 |

---

## 三、下一批 PR 清单

按 ROI 排序（先修静默丢失，再修 query param 无效）：

### 🔴 P0：静默丢失（不修 PM 根本看不到）

**PR-1 · 修所有相对路径 href → 绝对路径**（小 · 消 4+ 条实际下发丢失）

- `src/lib/pm-todo/blog-drafts.ts:96-99` — `blog_draft_waiting` 两条路径都改绝对
- `src/lib/pm-todo/conversion-review-items.ts:104` — `conversion_needs_review` 改绝对
- `src/lib/pm-todo/conversion-review-items.ts:133` — `conversion_send_in_doubt` 改绝对
- 顺手加一条 lint / test：`ManualItem.href` 必须以 `https://` 开头（防止再犯）

预计：1 人时。零风险，纯字符串补 `https://app.magicengine.com.au` 前缀。C 级。

### 🔴 P1：落地页失效

**PR-2 · 修 `/site-audit` 404**（小 · 消 crawl_stale 全部）

`src/app/dashboard/clients/[clientId]/site-audit/page.tsx` 不存在，只有 `.../site-audit/pages` 存在。两条路：
- (a) 改 `crawl_stale` 的 href 到 `/site-audit/pages`（快，1 人时）
- (b) 新建一个 site-audit 概览页做 nav（大，1 天，跟别的 UI 一起排）

推荐 (a) 先解 bug。

**PR-3 · 修 `/conversions` 读 query param**（中 · 消 conversion_needs_review + conversion_send_in_doubt 深链）

`src/app/dashboard/conversions/page.tsx` 需要：
- 读 `?client=` 自动填入并触发查询
- 读 `?focus=` 自动定位/高亮到那条 outcome
- 读 `?status=in_doubt` 自动切到「待核对」筛选

预计：3-4 人时。B 级（涉及 URL state ↔ query state 同步逻辑）。

### 🟡 P2：路径别扭

**PR-4 · `/connectors/publer` 独立页 or 改 how 文案**（小/中）

要么真做独立 connector 页（推荐，一次做 LinkedIn/Publer/GitHub/WP/Shopify 一整套），要么 how 文案改成「打开链接 → 拉到最下面找『Publer 发布器』卡」（1 人时）。

**PR-5 · `price_claim_unbacked` href 加 `?post={id}` 高亮**（小）

`src/lib/pm-todo/manual-items.ts:1044` 加 postId 到 URL。`/assets` 页要接住这个参数高亮那张图。

预计：2 人时。C 级。

### 🟡 待验证：Ads Manager 深链

**用真实广告账户 ID 和 adset ID 补测 `ad_readback_blocker`**（小）

本次审计只核对了 `adsmanager.facebook.com` 域名，没有用真实 `act=` / `selected_adset_ids=` 走一遍确认 PM 账户权限够、参数真的定位到目标广告组。下一轮审计需要拿一条真实 CTS 广告账户/adset id 实测，再改判 ✅ 或列入修复清单。

预计：0.5 人时（需要一条真实广告账户访问权限）。C 级。

### 🟢 P3：体验小事

**PR-6 · SPA loading 骨架屏**（中 · 影响 execution / content-factory / 所有重 SPA）

这个不属于 kind 特有，是 `/dashboard/*` 通用问题。可以留到别的 UI iteration 一起做。

---

## 四、审计元数据

- Metadata JSON：[docs/audits/2026-09-07-href-page-metadata.json](./2026-09-07-href-page-metadata.json)
- Stage 1 href 清单：[docs/audits/2026-09-07-daily-todo-href-list.md](./2026-09-07-daily-todo-href-list.md)
- Playwright 脚本（备用，本次改用 Claude in Chrome 完成）：[scripts/audit-hrefs.mjs](../../scripts/audit-hrefs.mjs)

## 五、Reuse Statement

- **复用了什么已有平台能力**：Claude in Chrome MCP（会话内 Chrome 自动化）；已有的 `dropBrokenLinks` / `action-link` 逻辑作为判据依据
- **新增内容 platform-shared**：审计报告和 metadata（纯 docs，不动 shared runtime）
- **industry-specific**：无
- **client-specific**：无（CTS/LINKEDIN 只作为测试样本，不是永久判据依据）
- **有没有把客户名/客户 ID/行业判断或客户私有事实写进 shared runtime**：没有；报告里的 CTS UUID 是登记的测试样本，PR 清单里的修法都是 client-agnostic
- **memory 升级**：本次审计发现「相对路径 href 会被 dropBrokenLinks 静默丢掉」这条已在 [PITFALLS §D](../PITFALLS.md) 有 cross_client_leak 事故记录；本次证实 `blog_draft_waiting` / conversions 两条 kind 犯了同一个 bug，无需新增 memory，PR-1 的 lint 规则是防再犯的机制层修复
