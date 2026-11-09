# 每日待办 href 落地页清单（阶段 1 · 枚举）

**日期**：2026-09-07
**范围**：`src/lib/pm-todo/**` 里所有下发给人工的 `href` 目标
**目的**：为阶段 2（Playwright 实测）准备一份不重复的 URL 列表

**占位符**
- `{CTS}` = `c0000000-0000-0000-0000-000000000000`
- `{LINKEDIN}` = `377468af-b103-45f0-984a-b353febb56a1`
- `{goalId}` = 任取一条真实目标 id（阶段 2 用真库查）
- `{contactId}` = 任取一条真实联系人 id
- `{adAccountId}`/`{adSetId}` = 真实 CTS 广告账户 id
- `{outcomeId}` = 一条 outcome id
- `{prNumber}` = GitHub PR 号

## 一、按 kind 逐条列出

### A. 内部落地页（app.magicengine.com.au）

| kind | href 模板 | 类型 | how 提示的期望动作 |
|---|---|---|---|
| `not_indexed` | `/dashboard/clients/{CTS}/site-audit/pages?filter=not-indexed` | internal-app | 打开清单 → 按每页原因去改 / 去 GSC 请求收录 |
| `meta_stuck` | `/dashboard/clients/{CTS}/settings` | internal-app | 登客户网站后台看 WP 插件是否停用 |
| `crawl_stale` | `/dashboard/clients/{CTS}/site-audit` | internal-app | 点「重新扫描网站」 |
| `mailchimp_export_broken` | `/dashboard/clients/{CTS}/settings` | internal-app | 在「Meta 广告线索送进哪个 Mailchimp 名单」栏填 Audience ID |
| `price_claim_unbacked` | `/dashboard/clients/{CTS}/assets` | internal-app | 去素材库改「来源=客户实拍（已确认）」，或从文案里去掉价格 |
| `goal_baseline_mismatch` | `/dashboard/clients/{CTS}/goal/{goalId}` | internal-app | 打开目标页改起点数字 |
| `leads_metric_untrusted` | `/dashboard/clients/{CTS}/goal/{goalId}` | internal-app | 打开目标页看现值不能信的原因 |
| `linkedin_progress_needs_review` | `/dashboard/clients/{LINKEDIN}/content-factory` | internal-app | 内容工厂看板找带「(needs review)」的草稿批准 |
| `linkedin_progress_needs_setup` | `/dashboard/clients/{LINKEDIN}/connectors/publer` | internal-app | 把 LinkedIn 账号填进 Publer 项，然后回内容工厂对每条草稿点确认 |
| `linkedin_progress_failed` | `/dashboard/clients/{LINKEDIN}/connectors/publer` | internal-app | 看 LinkedIn 是不是掉线 |
| `dnc_maybe_wrong` | `/dashboard/clients/{CTS}/crm/all?contact={contactId}` | internal-app | 点开黄条「判错了？点这里放回名单」 |
| `dm_maybe_stop` | `/dashboard/clients/{CTS}/crm/all?contact={contactId}` | internal-app | 在联系人记录里写一句话（两种都得写） |
| `cross_client_leak` | `/dashboard/clients` | internal-app | 进客户设置页核对配置归属 |
| `email_reply_due` (定位到人) | `/dashboard/clients/{CTS}/crm/all?contact={contactId}` | internal-app | 打开联系人看邮件回复 |
| `email_reply_due` (客户级) | `/dashboard/clients/{CTS}/crm/all` | internal-app | 打开全部联系人 |
| `email_sync_stale` (客户级) | `/dashboard/clients/{CTS}/settings` | internal-app | 重连邮箱 / 检查授权 |
| `email_sync_stale` (全站) | `/dashboard/clients` | internal-app | 列表页选客户处理 |
| `blog_draft_waiting` (已连通道) | `/dashboard/clients/{CTS}/blog` ⚠️ **相对路径** | internal-app | 打开看一眼觉得可以就点发布 |
| `blog_draft_waiting` (通道断) | `/dashboard/clients/{CTS}/settings` ⚠️ **相对路径** | internal-app | 先去接通发布通道 |
| `auto_run_blocked` | `/dashboard/clients/{CTS}/execution` | internal-app | 打开执行看板 |
| `auto_run_stuck` | `/dashboard/clients/{CTS}/execution` | internal-app | 打开执行看板 |
| `kernel_needs_human` | `/dashboard/clients/{CTS}/execution` | internal-app | 打开执行看板 |
| `diagnostic_findings` | `/dashboard/clients/{CTS}/execution` | internal-app | 打开执行看板看方向（体检结果已自动排成动作） |
| `prescription_updated` | `/dashboard/clients/{CTS}/execution` | internal-app | 打开执行看板看新方案 |
| `action_unattributable` | `/dashboard/clients/{CTS}/execution` | internal-app | 打开执行看板 |
| `outcome_rows_orphaned` | `/dashboard/clients/{CTS}/execution` | internal-app | 打开执行看板 |
| `factory_worker_idle` | `/dashboard/factory` | internal-app | 提示去 Mac 上跑 `node scripts/factory-worker/worker.mjs --loop` |
| `conversion_needs_review` | `/dashboard/conversions?client={CTS}&focus={outcomeId}` ⚠️ **相对路径** | internal-app | 核对要不要告诉广告平台 |
| `conversion_send_in_doubt` | `/dashboard/conversions?client={CTS}&status=in_doubt` ⚠️ **相对路径** | internal-app | 核对断线的发送 |
| GBP setup: needs-location | `/dashboard/clients/{CTS}/settings` | internal-app | 补 GBP location |
| GBP setup: needs-connect | `/api/auth/google/connect?client_id={CTS}` | oauth-start | 一次授权覆盖 GBP+GSC+GA4+Indexing |

### B. 第三方外部控制台

| kind | href | 类型 | how 提示的期望动作 |
|---|---|---|---|
| `cron_not_running` (render 组) | `https://dashboard.render.com` | third-party-console | 找服务 → Environment 里勾 me-shared-cron-secret |
| `cron_not_running` (github-actions 组) | `https://github.com/bigbigraydeng-maker/magic-engine/actions` | third-party-console | Actions 页找工作流点 Run workflow |
| `cron_not_running` (inngest 组) | `https://app.inngest.com` | third-party-console | Production → Apps → magic-engine-web → Sync |
| `cron_not_running` (external 组) | `https://dashboard.render.com` | third-party-console | 按服务名找 |
| `cron_stuck` | `https://dashboard.render.com` | third-party-console | Logs 看卡在哪一步 |
| `cron_blind` | `https://dashboard.render.com` | third-party-console | （其实是开发欠账，how 就说不用你动手） |
| `attribution_audit_failed` | `https://dashboard.render.com` | third-party-console | 看归因任务日志 |
| `client_list_unreadable` | `https://dashboard.render.com` | third-party-console | 看 DB 状态 |
| `video_credits_out` | `https://muapi.ai/topup` | third-party-console | 充值出片余额 |
| `dataforseo_credits_out` | `https://app.dataforseo.com/` | third-party-console | Billing → Add Funds 充值 |
| `paid_signal_needs_review` | `https://admin.mailchimp.com/audience/contacts/` | third-party-console | 在 Mailchimp 搜邮箱加 paid_customer 标签 |
| `ad_readback_blocker` | `https://adsmanager.facebook.com/adsmanager/manage/adsets?act={adAccountId}&selected_adset_ids={adSetId}` | third-party-console | Ads Manager 找广告组按提示改 |
| `comment_token_invalid` | `https://developers.facebook.com/tools/explorer/` | third-party-console | Graph Explorer 换 token |
| `comment_scope_missing` | `https://developers.facebook.com/tools/explorer/` | third-party-console | Graph Explorer 补 scope |
| `blog_pr_open` | `{row.pr_url}` (GitHub PR URL) | github-pr | 打开检查通过后 Merge |
| `platform_candidate_review_due` | `https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md` | github-markdown | 更新登记表的「硬证据进度」和「复查日」 |

## 二、去重后的实测 URL 集合（阶段 2 用）

内部落地页（CTS 客户；配套时也测一次 LinkedIn 客户）：

1. `https://app.magicengine.com.au/dashboard/clients/{CTS}/site-audit/pages?filter=not-indexed`
2. `https://app.magicengine.com.au/dashboard/clients/{CTS}/settings`
3. `https://app.magicengine.com.au/dashboard/clients/{CTS}/site-audit`
4. `https://app.magicengine.com.au/dashboard/clients/{CTS}/assets`
5. `https://app.magicengine.com.au/dashboard/clients/{CTS}/goal/{goalId}`
6. `https://app.magicengine.com.au/dashboard/clients/{LINKEDIN}/content-factory`
7. `https://app.magicengine.com.au/dashboard/clients/{LINKEDIN}/connectors/publer`
8. `https://app.magicengine.com.au/dashboard/clients/{CTS}/crm/all?contact={contactId}`
9. `https://app.magicengine.com.au/dashboard/clients/{CTS}/crm/all`
10. `https://app.magicengine.com.au/dashboard/clients`
11. `https://app.magicengine.com.au/dashboard/clients/{CTS}/blog` （⚠️ 相对路径下发，看它到底跳哪）
12. `https://app.magicengine.com.au/dashboard/clients/{CTS}/execution`
13. `https://app.magicengine.com.au/dashboard/factory`
14. `https://app.magicengine.com.au/dashboard/conversions?client={CTS}` （⚠️ 相对路径下发）
15. `https://app.magicengine.com.au/dashboard/conversions?client={CTS}&status=in_doubt`
16. `https://app.magicengine.com.au/api/auth/google/connect?client_id={CTS}` （只看响应头别真授权）

外部第三方：

17. `https://dashboard.render.com`
18. `https://github.com/bigbigraydeng-maker/magic-engine/actions`
19. `https://app.inngest.com`
20. `https://muapi.ai/topup`
21. `https://app.dataforseo.com/`
22. `https://admin.mailchimp.com/audience/contacts/`
23. `https://adsmanager.facebook.com/adsmanager/manage/adsets?act={adAccountId}`
24. `https://developers.facebook.com/tools/explorer/`
25. `https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md`
26. 一条真实 blog_pr_open 的 GitHub PR URL（阶段 2 从库查最新一条）

## 三、初判提示（给阶段 3 agent 用）

- **⚠️ 相对路径 hrefs**：`blog_draft_waiting` / `conversion_needs_review` / `conversion_send_in_doubt` 三条 href 是相对路径。CLAUDE.md 里 `cross_client_leak` 明确指出「相对路径会被链接闸判成 broken，整条待办被丢掉」——需要现场验证这三条在真实邮件里是被 action-link 保留还是丢弃。
- **`{contactId}` 参数**：`crm/all?contact=` 那一页据代码注释「真的读且自动展开到人」，阶段 2 必须验证。
- **`factory_worker_idle` href → `/dashboard/factory`**：how 让人到 Mac 上跑 CLI 命令。落地页跟能力是错位的（PM 打开看不到「启动 worker」按钮）。
- **`diagnostic_findings` / `prescription_updated` → `/execution`**：PM 2026-08-04 已拍板从体检报告改到执行看板，验证真到执行看板且看到有可动作的卡片。
- **`platform_candidate_review_due` → GitHub markdown**：外部但正确目的地，agent 别误判成"落地页 UI 不对"。
- **GitHub PR 类 `blog_pr_open`**：外部但正确目的地。
- **第三方控制台类**：外部但正确目的地（充值 / Ads Manager / Graph Explorer 等）；判据是"点进去就能做那件事"而不是"落地页有 ME 内部按钮"。
