---
id: 2026-10-23-social-cross-campaign-scheduler-not-built
title: 跨活动统筹排期（发布日历）只有设计稿没有代码，每日计划目前是直通发布线，PM 要求另开窗口做
status: decided
owner: agent
decided_on: 2026-10-23
source: session:b972dd89
verify_how: 查 docs/specs/2026-10-14-publishing-calendar-design.md 对应的代码是否已落地（src/lib/social 下有无发布日历/排期模块、是否有候选表）；没有就看新窗口是否已先过平台层级判定并开出设计或 PR
---
PM 10-23 指出：不同活动/营销会生成不同社媒内容，需要一个统一统筹的 Agent 排期账号每天发什么。核查结果：10-14 PM 已拍板「发布日历」（各来源自动报名、自动挑选、每周授权一次），设计稿在 docs/specs/2026-10-14-publishing-calendar-design.md，另有 docs/specs/2026-10-13-social-daily-agent-design.md（v0.5）。代码里只有 src/lib/social/week-overview 一个雏形，没有候选表和排期逻辑。

现状：每日计划提交后经管理员逐日审核即走现有发布线；自动发布开关关闭、授权记录为空，目前人工按内容发。

下一步：另开窗口做。开工前先过平台层级判定（Skill me-platform-tier-gate）并输出 Tier Classification Report，再读上面两份设计稿，核对 PR 2906（社媒 Agent 能力地图 v0.3，PM 尚未点头）与 Codex 六平台连接层的边界，避免重复造。本窗口没写任何代码。
