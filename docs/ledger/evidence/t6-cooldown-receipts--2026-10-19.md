# T6 冷却期闸 · 回执（2026-10-19 NZ 12:40–12:42）

**代提交说明**：本次请求由 18 号窗口在 PM 已登录的 Chrome 会话里代提交（PM 回「做T6」，仅此一次，不重试）。

## 结论一句话
**T6 按清单字面「未通过」（第二次没有被拒）；但原因不是冷却期闸坏了，而是清单的前提错了：人按的止损走的是「人工止损信封」，设计上就不查 72 小时。** 真正的冷却期闸管的是 AI 自治路径，我用真代码+真生产数据做了只读评估，它在那条路径上拒得对。

## 一、提交结果（只读读回）
`POST /api/clients/4ae76381-cd45-43bd-85cd-98cfd7604007/ad-health/stop-loss`，body `{campaign_id:52596939123525, action:pause, request_id:a94c6413-…}`，2026-10-18T23:40:43Z → HTTP 200，`executed:true`。

`action_runs` 2d847100-8430-4c2c-a2bb-2877eb9c23c4：`ads.pause_campaign`，`succeeded`，`triggered_by=human`，created 23:40:45.37 → finished 23:40:58.97；幂等键 `ads.pause_campaign:5897a6e9…` 与第一次（`856adffe…`）**不同**（新 request_id 起了作用，不是重放）。
三步全 succeeded：`apply` 又是 `{applied:false, prior_status:PAUSED}`（没调 Meta 写接口），`readback` 验证 `ads_readback_integrity` passed。授权 `verdict=allow`，`mode=auto_approve`。
Meta 端（官方连接实读）：该系列仍 PAUSED、`updated_time` 仍 2026-09-23；NAL 其余 4 个系列 `updated_time` 全部未变（09-21 / 09-21 / 09-16 / 09-28）。**没有误动。**
库里 NAL 的 `ads.*` 执行记录现在 **2 条**，都是空操作。

## 二、为什么没被拒（读代码，位置可核）
`src/lib/kernel/autonomy-envelope.ts`：
- 第 214–256 行的注释：`isWithinEnvelope` 那套 AI 信封有「72h 冷却 / 学习期 / 日上限」等条件，是为「防 AI 反复折腾」设计的；2026-09-27 用生产数据证明拿它拦**人按的刹车**会让刹车 100% 拧不动，所以另立 **`HUMAN_STOP_ENVELOPE`**，判据只剩「有撤回函数」「暂停必须是 pause/0」「减预算只能减」。注释原话：「学习期和 72h 冷却保护的是学习进度，不是钱」。
- 第 289–320 行 `isWithinHumanStopEnvelope`：没有任何冷却期判断。
- 第 345–370 行 `selectEnvelopeVerdict`：`triggeredBy==='human'` **且**动作在白名单（`ads.pause_unit` / `ads.pause_campaign` / `ads.cut_unit_budget` / `ads.cut_campaign_budget`）→ 走人工信封；其余一律走 AI 信封。
所以：**通过止损页面 / 路由提交的暂停与减预算，无论是不是空操作，都不受 72 小时限制。** 这是设计，不是缺陷。同时它也说明——用这条路验证冷却期闸，**从原理上就验证不了**。

## 三、只读评估：真代码 + 真生产数据，冷却期闸在 AI 路径上拒得对
**证据等级：只读评估（闸的评估结果，非生产执行记录）。** 零写入、不请求 Meta、不建 action_run，脚本已删。
对同一对象（NAL 系列 52596939123525，`ads.pause_campaign`）用真解析器 `createAdsEnvelopeFactsResolver` 读事实（2026-10-18T23:42:24Z）：
`hoursSinceLastChange = 0.0239`（来自 `hoursSinceOwnLastAction` 读到的内核执行记录，PR 2880 的新逻辑），`dailyCapCents=10000`，其余事实齐全。再用 `selectEnvelopeVerdict` 分别按两种触发身份判：

- `triggeredBy=human` → `within:true`，`envelopeUsed:"human_stop"`（与上面一致：放行）
- `triggeredBy=agent` → `within:false`，`envelopeUsed:"ads_autonomy"`，reasons：**「距上次设置变动只过了 0 小时，不足 72 小时（反复改会一直重置学习期）」**

这一条同时证明三件事：①`hoursSinceOwnLastAction` 在真实数据上读得到内核执行记录（PR 2880 的修复有效）；②空操作的成功记录也被算作「刚动过」（偏严，符合设计）；③AI 路径的冷却期闸会拒，且原文含「不足 72 小时」。

## 四、局限
- 这是**评估**，不是一条真实被拒的生产记录。要得到后者，必须让 AI 路径真的提交一次（D3 自动暂停、O1 加预算等），那需要关演练开关或有 O1 命中，**不在本轮范围**，也找不到不影响在投广告的更小办法
- 台账 `2026-09-28-envelope-facts-cooldown-blind-to-kernel-own-changes` 的验收第 3 条（连做两次改动、第二次被拦）**仍未以生产记录验过**，只有本页的只读评估；是否据此标 verified 由 18 号 / PM 定
