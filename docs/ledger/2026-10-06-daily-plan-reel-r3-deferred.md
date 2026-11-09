---
id: 2026-10-06-daily-plan-reel-r3-deferred
title: 每日计划接 Remotion 出片的第二步（R3：触发→建工单→回写）推迟，等 Remotion 在 CTS 跑稳两周再做
status: decided
owner: pm
decided_on: 2026-10-06
source: session:aa674920
verify_by: 2026-10-20
verify_how: 看 Remotion 出片在 CTS 是否已连续跑稳两周（有真实成片进审片队列、没有大面积被拒收/作废）；跑稳了再问 PM 是否开 R3；同时确认官网事实快照 PR 2270 的处理（它跟 R3 一起推迟）
---
PM 2026-10-06 回「停」：每日计划接 Remotion 出片的 R3（管理员触发 → Inngest 事件 → 建 montage 工单 → 回写计划回执，A 级，需往生产库建测试工单）**不做**，依据 10-05「瘦身」口径（`docs/specs/2026-10-05-content-foundation-trimmed-scope.md`：Remotion 先只做 CTS 一两个模板接入出片机，其余等跑稳两周）。
**触发条件**：Remotion 在 CTS 跑稳两周后，由 PM 决定是否重开 R3；方案现成，见 `docs/specs/2026-10-06-daily-plan-reel-video-outlet.md`（含 PR2 步骤与三个待拍板项）。
**现状（如实）**：R2b 的服务端「生成视频参数」已合并（#2301，`src/lib/factory/remotion-daily-plan/`，26+7 条测试），但**现在没有任何调用方**——没有路由、事件、建工单，不影响任何运行中的流程，留作 R3 的零件。官网事实快照 PR 2270（草稿）**一起推迟**，不再为 R3 赶着转正；其安全审查（统筹已安排狄仁杰）按它自己的节奏走。
**连带**：广告出口 R4 本来也没开；本卡不改变「视频只走工厂、真发布与真开广告必须 PM 点头」的规矩。
