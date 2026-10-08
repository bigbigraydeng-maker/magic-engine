# 每日计划 Facebook 帖「首评」功能设计（让帖子能过审、能发）

2026-10-08 · 每日计划推进窗口 · 基线 `origin/main` 之后 · PM 2026-10-08 回「做首评」。风险级 **A**（发布出口 + 审核闸）。
读过：`playbook-social-general`、`feedback-status-field-as-authorization-leaks-gates`、台账 `2026-09-29-social-content-publish-governance`。层级门：Inline，归既有「社媒」支柱 + 既有 Facebook 发布 Connector，无新能力。

## 0. 结论
- **现状**：9/29 起每日计划 Post 的审核服务端强制把「CTA 在首评、不在正文」「首评链接带追踪参数」两项记为**未测**，PASS 一律 422（`post-review/route.ts:~210`）；发布路由把 `cta: cta_url` 拼进正文（`publish/route.ts:~210`）。结果：**任何每日计划帖都不能过审、不能发**。
- **做法**：补上「发完后在第一条评论放链接」。**Reel 已有同款**（`reel-publishing.ts` 纯函数 + `facebook-reel-adapter.ts` 的 `ensurePageFirstComment`，带幂等标记），本方案**复用并泛化**，不另写一套。

## 1. 改什么（5 处，均复用）
1. **共用零件**：把 `ensurePageFirstComment` 从 `factory/publish/facebook-reel-adapter.ts` 抽到 `src/lib/meta/first-comment.ts`（参数：对象 id、token、幂等标签、文案、日志标签），Reel 适配器改为调用它（行为不变）。`buildTrackedReelUrl` 加可选参数 `utmCampaign`（默认仍为 `me_factory_reel`，Reel 不受影响）。
2. **纯函数**（新）`src/lib/campaign/daily-plan-first-comment.ts`：`buildDailyPlanFirstComment({cta, ctaUrl, planId, date})`（utm_campaign=`me_daily_plan`，utm_content=`<计划前8位>-<日期>`）、`buildDailyPlanPostMessage(post)`（只含 hook + body，**不含 CTA 与链接**）、`buildDailyPlanAutoChecks(...)`（复用 `buildReelPublishAutoChecks`，endcard = `{cta, url}`）。
3. **审核路由**：PASS 时由**服务端**用上面的函数算两项自动检查（PASS/FAIL），不再写「未测」、不再 422；正文含 CTA 或链接 → FAIL，不能过。
4. **发布路由**：发帖文案改为 `buildDailyPlanPostMessage`；即时发布拿到帖子 id 后立刻 `ensureFirstComment`；**定时发布**（Graph 只回照片 id）由现有 `daily-plan-post-story-resolve` 工作流在读到 `page_story_id`（帖子已公开）后补发首评。回执 `published[]` 加 `first_comment_status`（`POSTED` / `PENDING_PUBLISH` / `FAILED`）与 `first_comment_id`。
5. **界面**：审核卡去掉「不支持 CTA 首评」的黄条，改为显示将发出的首评预览（文案 + 带追踪参数的链接）。

## 2. 失败怎么办（不许死在日志里）
- 帖子已公开但首评失败：**不撤帖、不重发帖**；写失败记录进今日待办（what：哪天哪条帖缺首评；how：点哪里补发；href：该日计划页），回执标 `FAILED`。首评补发走同一个幂等标记，重跑不会发两条。
- 发布前任何一项自动检查 FAIL → 现有闸门照旧拦（审核、队列回执、发布三处都已读清单）。

## 3. 红线对表
对外文案仍先核官网（本方案不改文案内容）；发布仍需 PM 授权事件，fail-closed 不变；首评与正文同样过价格闸（首评里不带价格）；客户私有信息不进共享代码。

## 4. 验证与试跑
- 单测：纯函数、审核路由（PASS 通过/正文含链接 FAIL）、发布路由（即时 / 定时 / 首评失败不重发帖 / 幂等）、story-resolve（补发首评、失败记录）、Reel 适配器回归。变异：去掉首评调用 / 把 FAIL 当 PASS，对应测试必红。
- **当场试跑**：本机演练（`no_publish`）逐条验证 CTS 两份计划 14 条的审核清单可全 PASS、预览文案与链接；真评论要发到公开帖，**需 PM 授权后用第一条真实发布的帖验证**，台账 `verify_by` = 首次真发布当天。
- **待核实（实现第 0 步先做）**：Page token 是否具备评论权限（近期有 comment-autoreply 的 scope 修复，改 scope 会静默断连，**不改 scope**，只读核对）；Reel 首评在生产里是否已真发成功过。

## 5. 设计复审后修订（子牙 + 魏征，2026-10-08）——以本节为准，覆盖上文冲突处
**第 0 步（不通过就停）——已核实结果：CTS 的 Meta 授权缺 `pages_manage_engagement`（评论权限）**（只读探针，生产实测；另查：CTS 最近 5 条已发布成片的回执里都没有 `first_comment_id`，原因未查）。需 PM 在客户设置里点一次「连接 Meta」重新授权；改授权范围有静默断连风险，**代码不改授权范围，只提示 PM 重新授权**。授权补齐前，首评功能代码可先写、测，但不得真发。

**必须并入**
1. 价格闸输入 = 正文 + 首评全文：新函数返回 `{message, firstComment}`，价格检查与价格事实检查（`price-fact-gate.ts` 的 `buildPostPriceText`，调用方 `publish/route.ts` 与 `pm-todo/price-fact-items.ts`）都判两者拼接；各配一个变异测试。
2. 发布前**重算**自动检查（不信审核时存的清单）；任一 FAIL → 409，不发。
3. `StoryResolveDue` 加 optional `first_comment`；首评放进 `emitResolved` 之后的独立 `step.run`，失败只写记录、不重试整个步骤；已撤回的帖跳过。
4. 泛化首评函数：文案参数化、前缀区分（`daily-plan-first-comment:`）、评论目标必须是 `<pageId>_<storyId>` 形式（只有照片 id 时标 `PENDING_PUBLISH`，不去评论）、发前断言页面一致；读评论翻页至上限，读不到标记按「未知」不发。
5. 状态：`POSTED` / `PENDING_PUBLISH` / `FAILED` / `SKIPPED_NO_STORY`；结果写测量记录（避免和计划 CAS 冲突），并**新增待办读取**：`FAILED` 或 `PENDING_PUBLISH` 超时 → 今日待办出现（what/how/href），配测试。
6. CTA 检测：忽略大小写，覆盖 `http`、`www.`、裸域名、短链、`utm=`、全角冒号、URL 编码，并用 CTA 文案子串比对。
7. 改动清单补：`daily-plan.ts:519`、`CampaignDailyPlanPanel.tsx:458`、`publish-queue/route.ts:161`、`post-review` 测试、`content-review.test.ts`、`story-resolve` 测试。

**范围**：不拆「即时/定时」两个功能（每日计划帖基本都是定时）；按风险拆两个 PR：**PR-A** 零件（共用首评函数、纯函数、测试，不改任何运行中行为）→ **PR-B** 接线（审核、发布、story-resolve、价格闸、待办、界面）。PR-B 为 A 级，保持草稿，PM 回「合」才合。
