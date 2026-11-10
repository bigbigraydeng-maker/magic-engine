---
id: 2026-11-10-auto-pause-figma-fde-ui
title: 自动暂停页按 Figma 重排（独立页 + 广告门嵌入）
status: done
owner: agent
decided_on: 2026-11-10
source: session:3890a1b2
verify_how: 打开客户自动暂停页：摘要格、建议卡、确认卡跳转、账本已暂停/驳回分区；侧栏与待办链到 ad-health/auto-pause；点「出确认卡」仍只走既有 decision API。
done_on: 2026-11-10
done_ref: commit:c61e85c7ee6e1e7fa69ebf78f132586882d69e1e
---

Figma 41-397；分支 claude/auto-pause-figma-ui-3890。样式复用 me-primitives 与确认卡页；未改 D3 规则与 Meta 写入。
