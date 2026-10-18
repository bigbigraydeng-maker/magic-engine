---
id: 2026-10-19-launch-signoff-118
title: 重大功能上线签字（最小版）：广告 Agent T1–T7 清单页、只追加签字事件表、签字人仅 PM 邮箱
status: done
owner: pm
decided_on: 2026-10-19
source: session:ccc90b3d
verify_by: 2026-10-23
verify_how: PM 点头后：①apply 迁移 20261019120000_launch_signoff_events.sql；②Render 配 LAUNCH_SIGNOFF_SIGNERS（PM 邮箱）、LAUNCH_SIGNOFF_EXECUTOR_KEY、LAUNCH_SIGNOFF_REVIEWER_KEY（两把不同）；③打开 /dashboard/launch-signoff 应显示 7 项「没测」且签字按钮灰着；④119 用执行钥匙写 T1 回执 → 18 用复核钥匙复核 → 页面 T1 变「通过」；⑤匿名访问该表应读到 0 行
done_on: 2026-10-19
done_ref: doc:src/lib/launch-signoff/service.ts
---
PM 10-19 经统筹 18 号转述：「允许」新建 launch_signoff_events，且只有 PM 本人邮箱能签。设计稿 docs/specs/2026-10-19-launch-signoff-design-v0.2.md（PR 2885）。
A 级草稿 PR；迁移未 apply、环境变量未配、未在真实库跑过——这些都要 PM 另点头。已知缺口见 PR 正文（签字不接任何开关；Inngest 留痕与今日待办提醒未做；提交号检查取严）。
