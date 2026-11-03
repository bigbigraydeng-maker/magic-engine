---
id: 2026-10-05-remotion-r2a-worker-branch
title: 出片机能接 Remotion 单了：工单自带参数，渲染完走原来的审核队列（草稿 PR，未合并）
status: decided
owner: agent
decided_on: 2026-10-05
source: session:88b90b13
verify_by: 2026-10-12
verify_how: PM 回「合」并授权后，在出片机领一张真实 remotion 工单（先配 FACTORY_REMOTION_CLIENT_IDS 与素材目录），看到它进审核队列且音频项、首评两项自动检查为通过才算成。
---
新分支在 scripts/factory-worker/remotion-branch.mjs，只认 brief.engine='remotion'，不认识的引擎一律拒。细节、试跑证据、两条已知限制见 docs/audits/2026-10-05-remotion-r2a-worker-branch.md。
