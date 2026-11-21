# 调整环节 T1b · DeepSeek 分轮指令（风险级 B，接在 T1c 之后）

- 权威说明：issue #3087（契约 §5–§7、Ray 10-24 四条决定、10-25 缩小范围）。唯一写入者：一个 Claude Code 会话发指令、跑 aider、审 diff。
- 前置：T1a（`promo/adjust.ts` + 类型）和 T1c（`memory/adjustment-decision.ts` + 迁移文件）已在 main。迁移**不在生产执行**，接口层测试一律用假库。
- 配方与坑：`reference-aider-deepseek-oneshot-recipe`；每轮一个文件、`--yes-always`；DeepSeek 写的 fixture 先核对再信。
- 不做：`void` 动作、100 条归档、`lesson_candidate`、单独 `recheck` 动作、写 `global_learned_lessons`、改 `plan_data`、碰钱、调用处方生成接口。

## 轮 1 — 确认入口（文件：`src/app/api/clients/[id]/marketing-plan/[planId]/promo/adjust/route.ts` + `__tests__/route.test.ts`）
写法照抄同目录 `verify/route.ts`（`requirePlanApproverAccess`，`.eq('updated_at', plan.updated_at)` 乐观锁，请求体多一个键 → 400）。
- `POST {action:'propose'}`：计划须 `approved` 且 `isAbnormalWindow` 为真，否则 409；同一 `window.start` 已有 `proposed|confirmed` 就原样返回；否则用 `suggestAdjustment` 生成 `proposed` 记录写进 `generation_meta.promo_adjustments`。
- `POST {action:'confirm', id, decision, override_reason?, note?}`：`decision !== suggested_decision` 且无 `override_reason` → 400；写 `confirmed_*`、`recheck_due = nextRecheckDate(...)`；`revise_prescription` 只返回 `next` 链接，**不调用生成接口**；确认后调用 `saveAdjustmentDecision`，把行 id 放进响应（本轮不改 `PromoAdjustmentRecord` 形状，id 暂不回填记录）。
- 验收（对应契约测试）：T8 非审批人 403 · T9 400 · T10 409 不写入 · T11 幂等 · T12 正常周 409 · T13 生成接口零调用 · T14 多键 400。

## 轮 2 — 退回草稿保留 + 到期提醒（文件：`[planId]/route.ts` 加测试、`promo/daily-watch.ts`、`promo/board.ts`、`pm-todo/promo-plan-watch-items.ts`）
- 退回草稿时 `promo_adjustments` 原样保留，只挪 `promo_checks`/`weekly_reviews`（T15，只加测试，尽量不改 `[planId]/route.ts:166` 那段）。
- `WatchCode` 加 `adjustment_needed`、`adjustment_recheck_due`；`PromoBoard` 加 `recheck_due_adjustment`、`adjustment_needed`；待办渲染补中文标题和 what/how/href 三件套（T16）。
- 复检回写：下一次 `propose` 时顺带把到期的 `confirmed` 记录写 `recheck` 并调用 `recordAdjustmentOutcome`（improved/worse/no_change/unknown 只比较 `results_goal`）。
- 验收：T16 到期出提醒、没到期不出、异常窗口未确认出 `adjustment_needed`。

## 每轮收尾
Claude 会话审 diff，跑 `npx tsc --noEmit` 与相关 vitest，贴退出码；PR 以 draft 开，写 DeepSeek 跑了几轮、合计花费。
