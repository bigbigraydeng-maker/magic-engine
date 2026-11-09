---
id: 2026-10-21-autoack-cooldown-wiring-tests
title: 安抚限频补两条保险测试：生产接线没漏、只认成功发出的记录（只加测试，不改行为）
status: done
owner: agent
decided_on: 2026-10-21
source: pr:2972
done_on: 2026-10-21
done_ref: commit:a3f6417e8
verify_by: 2026-10-24
verify_how: 看这个 PR 合并后 src/lib/inngest/functions/__tests__/conversation-inbound-autoack.test.ts 与 src/lib/messenger/__tests__/recent-outbound.test.ts 在主干全过；把生产实例里的 hasRecentOutbound 接线删掉，第一条测试应变红
---
来自 PR 2972 独立审查官的第三条意见：测试要钉住「失败或待发的行不算已回复」和生产接线。只加测试，没有改任何运行逻辑。
