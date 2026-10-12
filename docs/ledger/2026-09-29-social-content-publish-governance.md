---
id: 2026-09-29-social-content-publish-governance
title: 社媒 Post 与 Reel 审批必须携带可追溯清单并在能力未测时阻断
status: done
owner: agent
decided_on: 2026-09-29
source: doc:docs/ledger/2026-09-29-social-publish-gate-risk-accepted.md
verify_by: 2026-10-06
verify_how: A级审查后验证 Post review/queue/publish 与 Reel approve/worker 对缺项、失败和 NOT_MEASURED 均拒绝，合法已测清单才允许继续。
done_on: 2026-09-29
done_ref: pr:2193
last_checked: 2026-10-12
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
Post 审核记录服务端角色和结构化清单；Reel 记录人工清单及自动检查状态。
首评发布与音视频检测器未实现期间，审批与发布入口 fail-closed。
熔断判据留作纯函数，生产来源身份明确后再接线。
