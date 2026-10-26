# 社媒页面收口方案 v0.1：全站只留「社媒日常」一个概念（97 号，2026-10-16）

- **起因**：PM 看 ME 后台社媒板块，说「社媒日常 / 图文 Post / 视频 Reels 三个页面功能重叠，标题混乱：每日计划、社媒日常，概念太多」。我在 PR 2707 里把「总览」改名「社媒日常」，**恰好和页面大标题「每日计划」撞名**，这是我造成的，这版收口。
- **风险级**：B（文案、标签、入口卡合并、一个面板改读已有的客户级数据）；**不新建页面 / 接口，路由不变，不动授权 / 发布 / 开关**。
- **做法**：DeepSeek 写，子牙 + 魏征审，禁 Codex，不部署；改完让 PM 看一屏截图（浏览器里看管理员页要登录，我没有会话——截图由有登录会话的窗口截，或我用测试数据渲一屏）。

## 1. 三个标签现在各有什么功能、哪些重复（读代码核的，10-16）

页面 `/dashboard/clients/[id]/daily-plan`，大标题「每日计划」，标签（`page.tsx` 89–93 行）：**社媒日常｜图文 Post｜视频 Reels**。

| 功能 | 社媒日常（总览，`WeekOverviewPanel`）| 图文 Post（`CampaignDailyPlanPanel` + `CampaignDailyAutoPublishPanel` + 视觉方向）| 视频 Reels（`DailyPlanReelsPanel`）| 视频工厂页 `/dashboard/factory` | Story 页 `/story` |
|---|---|---|---|---|---|
| 演练 / 真发横幅 | ✅（Story 的）| ✅（图文自动发布自己的演练 / 真发提示）| — | — | ✅ |
| Story 本周条目与状态 | ✅（只读，缩略图）| 只有「故」小点 + Story 草稿卡片 | — | — | ✅（授权 / 停）|
| Reel 列表与状态 | ✅（列表 + 跳工厂）| 只有「片」小点 + 一句话「去视频 Reels 看」| ✅ **列表 + 视频播放器 + 按状态分组** | ✅ 审片、通过、打回 | — |
| Reel 审片 / 通过 / 打回 | 只有跳转 | — | **没有，只有跳转**（页面文字写明）| ✅ **唯一能做的地方** | — |
| 图文 7 日计划查看 | 「图文：未接入」| ✅ | — | — | — |
| 图文审核（通过 / 打回）| — | ✅ | — | — | — |
| 发布准备回执 / 授权自动发布 / 停止 / 撤回 | — | ✅ | — | — | Story 有自己的授权 |
| 推广活动切换、视觉方向 | — | ✅ | — | — | — |
| 头条与重复提示（本周三条线、BGM）| ✅ | — | — | — | — |

**真正重复的**（同一件事在两处都有）：
1. **Reel 列表 + 状态**：总览里有一份（`social-overview` 接口，已按客户过滤），视频 Reels 标签里又有一份（它另走 `/api/factory/work-orders`，**一次读回所有客户的工单再在浏览器里过滤**），视频工厂页还有一份。三处数据源不同、口径可能对不上。
2. **Story 状态**：总览有只读版，Story 页有可操作版；图文 Post 面板里还有 Story 草稿卡（计划快照里的草稿，不是已授权的周包）。
3. **演练 / 真发提示**：总览一条、图文自动发布面板一条，说的是两条不同的线，但都叫「演练 / 真发」，PM 容易混。
4. **「每日计划」这个词**：大标题、标签的无障碍标签、客户页入口卡、ContentHub、CampaignPanel、各类错误提示 / 按钮文案里都有。

**不重复、应保留的**：图文审核 / 发布准备回执 / 自动发布授权（只有图文 Post 标签有）；Reel 审片通过打回（只有视频工厂有）；Story 授权停（只有 Story 页有）。

## 2. 最小改动方案

**① 全站只留一个概念「社媒日常」。** 页面大标题 =「社媒日常」；UI 文案里「每日计划」一律去掉（内部代码名、路由 `/daily-plan` 不动）。
**② 三个标签改短名无歧义：「本周总览｜图文帖子｜短视频」。**（标签 key 不变：`overview` / `post` / `reels`，URL 不变。）
**③ 客户页入口卡合并成一张「社媒日常」**：去掉指向同一页的「每日计划」卡（`page.tsx` 644 行）；`ContentHub` 的「每日计划」快捷入口、`CampaignPanel` 里的「每日计划（内容排期审核）」链接改叫「社媒日常 · 图文帖子」。
**④ 「短视频」标签只做排期 / 状态与跳转**：去掉内嵌视频播放器和按状态分组的卡片，改成**与「本周总览」同一份数据**（`social-overview` 接口的 `reels`，已按客户过滤）的一张紧凑列表：状态、主题、工单号、「去视频工厂」；审片 / 通过 / 打回 / 看片一律去视频工厂页。这样**去掉第二个数据源和「读回所有客户工单」的做法**。
**⑤ 「图文帖子」标签**：保留审核 / 回执 / 授权；Story、Reel 草稿卡片改为一句话指向「本周总览 / 短视频」，不在这里再展示一遍（Story 草稿卡里的内容只读，保留小点以示该日有无排期）。具体到面板里要删的是 `CampaignDailyPlanPanel` 587–601 行的 Story 草稿卡与 Reel 说明卡，改成指向文字。

## 3. 「每日计划」文案清单（`git grep` 10-16 主干）

**第一批（本 PR，`src/app/dashboard/**` 页面文案，约 17 处）**：
- `daily-plan/page.tsx`：大标题（89）、标签无障碍标签（92）、空状态文案（122）
- `clients/[id]/page.tsx`：客户页「每日计划」入口卡（644，**合并后删除**）
- `_components/ContentHub.tsx`：快捷入口 label（13）
- `_components/CampaignPanel.tsx`：链接文案（575）
- `_components/CampaignDailyPlanPanel.tsx`：加载文案（315）、面板标题（353）
- `_components/CampaignDailyAutoPublishPanel.tsx`：错误 / 提示文案（92、95–98、157–158、561）
- `_components/DailyPlanReelsPanel.tsx`：文件头注释（10，注释不改文案也可，顺手改）

**第二批（另开 PR，`src/lib/**` 里**会出现在今日待办 / 提示里的文案，约 45 处，**涉及 116 号在做的推广计划与今日待办文件**，我不碰，交 116 号或等它合并后我再改）：
- `src/lib/marketing-plan/promo/`：`slot-gaps.ts`（14）、`gates.ts`（5）、`daily-plan-read.ts`（5）、`daily-watch-run.ts`、`daily-watch.ts`、`approval-record.ts`、`facts.ts`、`playbooks.ts`
- `src/lib/pm-todo/`：`auto-publish-items.ts`、`manual-item-types.ts`、`manual-items.ts`、`price-fact-items.ts`、`promo-plan-watch-items.ts`
- `src/lib/campaign/daily-plan-publish-effects.ts`（失败标签「每日计划帖」）、`src/lib/inngest/functions/daily-plan-post-story-resolve.ts`、`src/lib/factory/outlets.ts`（`每日计划(主页 Reel / 帖子 / Story)`）、`src/lib/meta/first-comment.ts`、`src/lib/auth/client-access.ts`

> 第二批的文案改动会让 PM 在今日待办和推广计划里继续看到「每日计划」，**第一批合并后我会通知 116 号并列出替换词（一律改「社媒日常」或「图文帖子」按语境）**；测试里写死这些字符串的用例要同步改。

## 4. 实施分轮（DeepSeek，每轮单文件或 ≤3 文件）
1. 标签与大标题（`daily-plan/page.tsx` + 其测试）；
2. 客户页卡片合并（`page.tsx`、`ContentHub.tsx`、`CampaignPanel.tsx`）；
3. 「短视频」面板改读 `social-overview` 的 reels、去播放器与分组（`DailyPlanReelsPanel.tsx` + 测试；该面板不再请求 `/api/factory/work-orders`）；
4. 图文帖子面板去重（`CampaignDailyPlanPanel.tsx` 587–601 行）与文案（`CampaignDailyAutoPublishPanel.tsx`）。
每轮跑 `npx vitest run src/lib/social WeekOverviewPanel daily-plan` 与 `tsc` 过滤相关文件；合并前子牙 + 魏征审；**当场试跑**：测试环境渲染三个标签各截一屏，大标题与标签名对得上；没有登录会话无法在真实页面截图时明说。
