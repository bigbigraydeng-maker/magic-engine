# 每日待办邮件 href 落地页 · 能不能真解决问题 · 审计报告

**日期**：2026-09-07
**范围**：`src/lib/pm-todo/**` 里所有下发给 PM 的 `href`，26 条不重复 URL
**执行方式**：Ray 自己的 Chrome（已登录 app.magicengine.com.au / Render / GitHub），我用 Claude in Chrome MCP 逐条实测抓 metadata + 关键页面截图
**判据**：落地页里有没有能**直接触发解决这个 kind 描述的动作**的按钮/表单/链接

---

## 一、总览

**计数单位**：以下按 **kind（含同一 kind 内验证结果不同的子分支）** 计数，不按 URL 去重（同一 URL 常被多个 kind 共用，例如 `/execution` 一条 URL 承载 6 个 kind；反过来同一 kind 也可能因为 provider 不同而对应多条 URL，例如 `cron_not_running` 拆成 github / render / inngest 三条）。这跟范围声明里「26 条不重复 URL」是两条不同的轴，互不冲突，不能相加。**每个 kind（或子分支）只进入下面四个 verdict 之一**——同一个 kind 里，如果不同触发分支的落地结果不一样（比如 `linkedin_progress_needs_review` 有的分支能批准、有的分支批准了会出事），拆开算成两条，各自归自己的 verdict，不共用父 kind 的判定。

| verdict | 条数（kind / 子分支） | 说明 |
|---|---|---|
| ✅ 落地页真能干活 | 31 | 内部落地页 UI 或外部页面就是正确目的地 |
| ⚠️ 部分能干，但落地或路径别扭 | 4 | 得多绕一步、需要额外知识 |
| ❌ 落地跟能力完全错位 / 直接失效 / 结构性做不完 | 6 | 404、只读页被要求做只有后台才能做的事、相对路径被链接闸丢掉、审批入口未启用、误操作会造成重复公开发布、动作只能在指定物理机器上完成 |
| 🟡 未实测（有理由） | 3 | OAuth flow 不能真跑；Ads Manager 深链没有用真实账户/广告组 ID 验证过；DNC 纠错按钮的样本联系人当时不在 DNC 状态 |

**31 + 4 + 6 + 3 = 44**，且每条只在一个桶里出现一次（SPA 首次载入慢这类跟「能不能完成动作」判据无关的体验问题，不再单独计数，只作为已 ✅ 条目下的备注，见下方脚注和 PR-6）。

---

## 二、逐条判定表

### ✅ 落地页真能干活（31）

| kind | 落地页 | 一句话 |
|---|---|---|
| `not_indexed` | [/site-audit/pages?filter=not-indexed](../../src/lib/pm-todo/manual-items.ts#L293) | h1「页面清单」，「未收录(4)」筛选生效 |
| `meta_stuck` / `mailchimp_export_broken` / GBP setup | [/settings](../../src/lib/pm-todo/manual-items.ts#L520) | h1「客户配置中心」，5 个 tab 可切换 + 保存按钮 |
| `price_claim_unbacked` | [/assets](../../src/lib/pm-todo/manual-items.ts#L1044) | h1「素材库」，48 全部/47 已分析等筛选（改单张素材「来源」要多一步点开，仍算可干；建议加 `?post={id}` 高亮定位，见下方 PR-5，这一条不再重复计入 ⚠️ 表） |
| `leads_metric_untrusted` | [/goal/{goalId}](../../src/lib/pm-todo/manual-items.ts#L1100) | h1 = 目标标题 + BETA + EXPIRED；how 让 PM 去客户网站统计后台改，页面只是用来核对是哪个目标，不依赖页面上的按钮（`goal_baseline_mismatch` 不算在内，见下方 ❌） |
| `linkedin_progress_needs_review`（`sensitiveReview` / `unknownDraft` 两个分支） | [/content-factory](../../src/lib/pm-todo/manual-items.ts#L1105) | h1「内容工厂」，draft 列表可批准（**`generation_context_snapshot.reason === 'published_but_db_sync_failed'` 那个分支不算在内，见下方 ❌**——那个分支的 `how` 明确写着「千万别批准，会发出重复的公开帖子」，内容工厂没有对应的「标记已发布」入口） |
| `dm_maybe_stop` / `email_reply_due` (focused) | [/crm/all?contact={id}](../../src/lib/pm-todo/manual-items.ts#L1453) | `?contact=` 生效自动展开到人；「记一笔」按钮在（`dnc_maybe_wrong` 不算在内，见下方 🟡 未实测） |
| `email_reply_due` (client-level) | [/crm/all](../../src/lib/pm-todo/email-reply-items.ts#L64) | 全部客人 tab 视图 |
| `cross_client_leak` | [/dashboard/clients](../../src/lib/pm-todo/manual-items.ts#L1545) | 33 客户列表，可点进设置纠正归属 |
| 6 个 kind（`diagnostic_findings` / `prescription_updated` / `action_unattributable` / `outcome_rows_orphaned` / `auto_run_blocked` / `auto_run_stuck`）→ `/execution` | [/execution](../../src/lib/pm-todo/manual-items.ts#L1821) | 执行看板：AI 推荐 3 件 + Key Signals + 5 Campaign 上下文 + 44/3/56 分栏（SPA 首次载入 5-7 秒空白，见下方 PR-6；`kernel_needs_human` **不算在内，见下方 ❌**——那三种状态 `href` 永远是空字符串，从不指向 `/execution`，见 [handoff.ts:69-112](../../src/lib/kernel/handoff.ts#L69)） |
| `platform_candidate_review_due` | [platform-candidates.md](../registry/platform-candidates.md) | 直达候选登记表 |
| `blog_pr_open` | GitHub PR URL | 直达 PR，Merge 按钮就在 |
| `cron_not_running` (github) | github/actions | 直达 Actions 页 |
| `paid_signal_needs_review` | mailchimp/audience | 直达 audience（需登录，未登录跳 login） |
| `video_credits_out` | muapi.ai/topup | 直达充值页 |
| `dataforseo_credits_out` | app.dataforseo.com | 直达 DataForSEO 后台 |
| `comment_token_invalid` / `comment_scope_missing` | Graph Explorer | 直达 Meta 图谱 API 探索工具 |
| `cron_not_running` (render/external) / `cron_stuck` / `cron_blind` / `attribution_audit_failed` / `client_list_unreadable` | dashboard.render.com | 直达 Render Overview |
| `cron_not_running` (inngest) | app.inngest.com | 直达 Inngest Dashboard |

### ⚠️ 部分能干，但落地或路径别扭（4）

`price_claim_unbacked`（已在 ✅ 表计过一次）、`factory_worker_idle`（结构性做不完，已移到下方 ❌ 表）、以及 `linkedin_content_factory` / `/execution` 家族的 SPA 首次载入慢，**不在本表重复计数**——它们要么已经在 ✅ 表里判过，要么不满足「能不能完成动作」这条 verdict 判据（首次载入慢是所有重 SPA 页面共有的体验问题，跟具体 kind 无关），只作为 PR-5 / PR-6 的备注保留在下面清单里。

| kind | 落地页 | 具体问题 | 建议 |
|---|---|---|---|
| `linkedin_progress_needs_setup` / `linkedin_progress_failed` | `/connectors/publer` 服务端 302 到 `/settings?tab=connect` | 邮件说的「Publer 连接器页」不存在独立 URL；落地在 settings 的「接通」tab 里能找到「🚀 Publer 发布器」卡但被夹在 10+ 个其他 connector 中间 | 要么真做一个 `/connectors/publer` 独立页，要么把 how 改成「打开链接 → 拉到最下面找『Publer 发布器』卡」 |
| `conversion_needs_review` | [/conversions?client={id}&focus={outcomeId}](../../src/lib/pm-todo/conversion-review-items.ts#L104) | `client=` 已经生效——`page.tsx:96-99` 在 mount 时读 `?client=` 写入 state，`load()` 的 `useEffect` 跟着自动触发查询，**不是完全被忽略**（上一版审计判错了）；真正没接住的只有 `focus=`：页面不会定位/高亮到那条具体 outcome，同一客户有多条待核对时 PM 要自己在列表里找 | 落地页读 `focus=` 自动定位/高亮到那条 outcome；`client=` 不用动 |
| `conversion_send_in_doubt` | [/conversions?client={id}&status=in_doubt](../../src/lib/pm-todo/conversion-review-items.ts#L133) | 同上，`client=` 生效、页面不是跟 bare `/dashboard/conversions` 完全一致；真正没接住的是 `status=in_doubt` —— 页面不会自动切到「待核对」筛选，PM 落地后要自己找 | 落地页读 `status=in_doubt` 自动切到对应筛选/定位 |

### ❌ 落地跟能力完全错位 / 直接失效 / 结构性做不完（6）

| kind | 落地页 | 严重程度 | 具体证据 | 修法 |
|---|---|---|---|---|
| `crawl_stale` | [/site-audit](../../src/lib/pm-todo/manual-items.ts#L540) | 🔴 P1 | HTTP 200 body 是 **404 页面**（Next.js 404） | 要么改 href 到 `/site-audit/pages`，要么在这个路径真做一个 site-audit 首页 |
| `goal_baseline_mismatch` | [/goal/{goalId}](../../src/lib/pm-todo/manual-items.ts#L1100) | 🔴 P1 | how 明确要求「把它改成 {recomputedBaseline}」，但目标页只读展示 `baseline_value`（`_client.tsx:208-216`），页面上的「Submit Verdict」只提交当前值和结论，仓库里没有任何能修改目标 baseline 的入口——PM 照 how 做不完这件事 | 要么在目标页/settings 加一个改 baseline 的表单 + API，要么把 how 改成「回我一句附上正确起点，我去后台改」，在那之前不要让这条指向一个做不完动作的页面 |
| `blog_draft_waiting` (有 2 个 href 变体) | 相对路径 `/dashboard/clients/{id}/blog` 或 `/settings` | 🔴 P0 静默丢失 | [action-link.ts:69-83](../../src/lib/pm-todo/action-link.ts#L69) 的 `verifyActionLink` 对相对路径走 `new URL('/xxx')` throws → 落到 `fetch` throws → 返回 `{kind:'broken'}` → [dropBrokenLinks](../../src/lib/pm-todo/manual-items.ts#L202) 判 broken 就 drop（`blog_draft_waiting` 不在 `NEVER_DROP_KINDS` 里，只有 `cross_client_leak` 是）→ **整条待办被 console.warn 丢掉，PM 邮件里根本看不到** | href 改绝对路径 `https://app.magicengine.com.au/dashboard/clients/{id}/blog` |
| `kernel_needs_human`（`pending_approval` / `denied` / 死信三种状态） | 无 href（[handoff.ts:69-112](../../src/lib/kernel/handoff.ts#L69) 三个分支都显式返回 `href: ''`） | 🔴 结构性（Enable 前置阻塞，非本轮 href 修复能解） | 代码注释原话：执行看板「根本不读 `action_runs`」「全仓也没有任何 UI / API 会调 `approveAndRun` / `rejectPendingRun`」；这不是落地页选错，而是 [`KERNEL-E7-APPROVAL-SURFACE`](../../src/lib/kernel/handoff.ts#L44)（认证操作者、能读 pending 决策的 UI/API、同意/拒绝两个动作、客户归属校验、审计留痕，七件事一件没做）导致的**当前无法完成**，不能被算进「7 个 kind → /execution」的 ✅ 桶里 | 不是这批 href PR 能修的：先补齐 `KERNEL-E7-APPROVAL-SURFACE` 七个前提，在那之前 `href` 如实留空是正确行为，不要为了「看起来能点」硬塞一个假链接 |
| `linkedin_progress_needs_review`（`generation_context_snapshot.reason === 'published_but_db_sync_failed'` 分支） | `/content-factory`（跟其他分支共用同一个 kind，但这个分支落地后**不能点批准**） | 🔴 高危（误批准 = 重复公开发布） | [manual-items.ts:1206-1211](../../src/lib/pm-todo/manual-items.ts#L1206) 和 [manual-items.ts:1267-1279](../../src/lib/pm-todo/manual-items.ts#L1267)：真实状态是「已经发出去了，只是数据库状态没跟上」，`how` 原文明确写「千万别在内容工厂看板里重新点批准发布」，唯一出路是「回我一句，我去手动把状态改成已发布」——内容工厂页没有、也不该有一个「标记已发布」的按钮给 PM 点，草稿列表的批准按钮对这一分支是危险动作 | 不是页面缺入口的 bug：`how` 已经正确要求转人工（开发改数据库状态），不需要新 UI；需要修的是**分类**——审计和后续报告不能把这个分支概括进「草稿列表可批准」，得单独标成「转发给开发，PM 不点任何按钮」 |
| `factory_worker_idle` | [/dashboard/factory](../../src/lib/pm-todo/manual-items.ts#L1734) | 🔴 无法从 Web UI 完成 | 驾驶舱页面只读展示队列，仓库里没有任何「远程启动 / 连接本地 worker」的入口；`how` 明确要求「去指定的 Mac 上跑 CLI 命令」——这满足的是「转成人工任务」的判据，不满足「落地页本身能触发解决动作」 | 要么加一个能远程唤醒/连接那台 Mac 的控制面（需要常驻 agent，工作量不小），要么如实承认这条**只能靠人在那台机器前手动启动**，别再把它算进「部分能干」——今日待办文案层面要按铁律 §3 的人工任务三件套处理（what / how / href 已经齐全，只是「href」这里注定打不开一个能替代物理操作的按钮） |

**⚠️ 关键：`blog_draft_waiting` 这条同一个 bug 早在 [manual-items.ts:1540-1544](../../src/lib/pm-todo/manual-items.ts#L1540) 的 `cross_client_leak` 注释里被明确记录过**（狄仁杰 2026-08-05 kept=0 事故），当时的修法是「加进 NEVER_DROP_KINDS」和「改绝对路径」——`blog_draft_waiting` 两条路径都没做，漏网了。

**⚠️ conversions 两条同样是相对路径会被 dropBrokenLinks 静默丢掉的 bug**：href 是相对路径 `/dashboard/conversions?...`，跟 `blog_draft_waiting` 是同一类问题（详见上方 ⚠️ 表格，这两条本身落地不算完全错位，只是 `focus=` / `status=` 两个参数没接住，且 href 相对路径这点仍需要修）。

### 🟡 未实测（3）

| kind | 落地页 | 理由 |
|---|---|---|
| GBP setup: needs-connect | `/api/auth/google/connect?client_id={id}` | 会真启动 Google OAuth flow，禁跑。功能上：点了就开始授权，无 UI 可 audit |
| `ad_readback_blocker` | `https://adsmanager.facebook.com/adsmanager/manage/adsets?act={adAccountId}&selected_adset_ids={adSetId}` | 只核对了域名是 adsmanager.facebook.com，没有用真实广告账户 ID 和 adset ID 验证过账户权限、`selected_adset_ids` 参数是否真的把 PM 带到目标广告组——这正是判据要求的「直接触发解决 kind 的动作」，仅查域名不满足，之前误标 ✅ 已改判为未实测 |
| `dnc_maybe_wrong` | [/crm/all?contact={id}](../../src/lib/pm-todo/manual-items.ts#L1453) | 这个 kind 只会在联系人仍处于 DNC 状态时生成，所需动作是点黄条「判错了？点这里放回名单」（[DncBanner.tsx:91](../../src/app/dashboard/clients/[id]/crm/_components/DncBanner.tsx#L91)）；但本次测试样本 metadata 明确记录 `hasDncWarning: false`（见 [href-page-metadata.json](./2026-09-07-href-page-metadata.json) `crm_contact_focused`），联系人当时不在 DNC 状态，黄条没有出现，只验证了 `?contact=` 定位和通用「记一笔」按钮——没有覆盖这个 kind 实际触发时的关键按钮，之前误标 ✅ 已改判为未实测 |

---

## 三、下一批 PR 清单

**先排除三个不属于这批 href 修复的结构性阻塞**（列在这里是为了不让它们被下面的清单「消掉」，误以为清零就等于都能跑了）：

- `kernel_needs_human`：不是 href 选错，是审批入口本身没上线（`KERNEL-E7-APPROVAL-SURFACE`，见上方 ❌ 表），需要单独立项补七个前提，不进本轮 PR。
- `linkedin_progress_needs_review`（`published_but_db_sync_failed` 分支）：`how` 已经正确要求转人工改数据库状态，不需要新 UI；需要做的只是把日常分类和报告口径改成「这个分支单独标不可批准」，不算代码 PR。
- `factory_worker_idle`：现状就是「只能人到那台 Mac 前手动启动」，不是一个网页 bug；要不要投入建远程唤醒能力是产品决策，不在这批 href 修复范围内。

按 ROI 排序（先修静默丢失，再修 query param 无效）：

### 🔴 P0：静默丢失（不修 PM 根本看不到）

**PR-1 · 修所有相对路径 href → 绝对路径**（小 · 消 4+ 条实际下发丢失）

- `src/lib/pm-todo/blog-drafts.ts:96-99` — `blog_draft_waiting` 两条路径都改绝对
- `src/lib/pm-todo/conversion-review-items.ts:104` — `conversion_needs_review` 改绝对
- `src/lib/pm-todo/conversion-review-items.ts:133` — `conversion_send_in_doubt` 改绝对
- 顺手加一条 lint / test：非空的 `ManualItem.href` 不能是相对路径，必须以 `https://` 开头（防止再犯）。**空 href 要放过**——`src/lib/kernel/handoff.ts:74-112` 会故意生成空 `href`（那件事的处理入口还没上线，如实不给假链接），[dropBrokenLinks](../../src/lib/pm-todo/manual-items.ts#L188-L196) 已经把空 href 当成 `unverifiable` 保留下来，不当 broken 丢掉；测试只拒绝「非空但不是 `https://` 开头」的值

预计：1 人时。零风险，纯字符串补 `https://app.magicengine.com.au` 前缀。C 级。

### 🔴 P1：落地页失效

**PR-2 · 修 `/site-audit` 404**（小 · 消 crawl_stale 全部）

`src/app/dashboard/clients/[clientId]/site-audit/page.tsx` 不存在，只有 `.../site-audit/pages` 存在。两条路：
- (a) 改 `crawl_stale` 的 href 到 `/site-audit/pages`（快，1 人时）
- (b) 新建一个 site-audit 概览页做 nav（大，1 天，跟别的 UI 一起排）

推荐 (a) 先解 bug。

**PR-2b · 目标页加「改 baseline」入口（或改 how 文案）**（小/中 · 消 goal_baseline_mismatch）

`goal_baseline_mismatch` 的 how 明确要求 PM 把 baseline 改成重算值，但 `/goal/{goalId}` 页（[_client.tsx:208-216](../../src/app/dashboard/clients/[id]/goal/[goalId]/_client.tsx#L208)）只读展示 `baseline_value`，「Submit Verdict」不碰这个字段，仓库里没有对应的改 baseline API/UI。两条路：
- (a) 目标页/settings 加一个改 `baseline_value` 的表单 + API（对齐 PM 的实际动作，推荐）
- (b) 先把 how 改成「回我一句附上正确起点，我去后台改」，别让待办指向一个做不完动作的页面（快，不解决根本问题）

预计：(a) 2-3 人时，B 级（涉及 goal 数据修正，建议留审计轨迹）；(b) 0.5 人时，C 级。

**PR-3 · 修 `/conversions` 读 `focus=` / `status=`**（中 · 消 conversion_needs_review + conversion_send_in_doubt 深链剩余部分）

`src/app/dashboard/conversions/page.tsx` 已经会读 `?client=` 自动触发查询（`page.tsx:96-99`），还需要：
- 读 `?focus=` 自动定位/高亮到那条 outcome
- 读 `?status=in_doubt` 自动切到「待核对」筛选

预计：2-3 人时。B 级（涉及 URL state ↔ query state 同步逻辑）。

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

### 🟡 待验证：DNC 纠错黄条

**用一个真实处于 DNC 状态的联系人补测 `dnc_maybe_wrong`**（小）

本次审计的测试联系人 metadata 记录 `hasDncWarning: false`，没有触发黄条「判错了？点这里放回名单」（[DncBanner.tsx:91](../../src/app/dashboard/clients/[id]/crm/_components/DncBanner.tsx#L91)），只验证了 `?contact=` 定位和通用「记一笔」按钮。下一轮审计需要挑一个 `do_not_contact=true` 的联系人实测黄条是否出现、点击后是否真的解除 DNC，再改判 ✅ 或列入修复清单。

预计：0.5 人时（需要一条真实处于 DNC 状态的联系人）。C 级。

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
