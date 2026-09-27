---
id: 2026-09-27-application-build-check-not-tamper-proof
title: Application build / Kernel architecture test 用 pull_request 触发，跑的是 PR 自己那份 workflow——今天不是防篡改的
status: decided
owner: agent
decided_on: 2026-09-27
source: pr:2104
verify_by: 2026-10-04
verify_how: 检查 pr-application-validation.yml、kernel-architecture.yml 等必过检查的 workflow 是否已改成 pull_request_target + 显式 checkout PR head SHA（或换成独立 GitHub App 身份出状态）；未改则维持 decided
---
Codex 审查发现：这几道 Protect main 必过检查用 `on: pull_request`，执行的是 PR 分支自己
那份 workflow 定义。PR 只要在同一次改动里把构建步骤换成必然成功的空壳、保留检查名不变，
产出的绿勾仍来自同一个 `integration_id`，规则集分不出真假。这类改动会因碰了 `.github/`
被判 A 级，但今天 A 级合并靠 PM 聊天里说一句 go，机器判不出 PM 是否看穿了 diff 里的猫腻。
已在 `.github/merge-authorization.md` 的「已知缺口」如实记录；真正修复需要把这些 workflow
换成 `pull_request_target` 精确 checkout PR head 构建（仿照 `pr-risk-gate.yml`），这次改动
范围不含 `.github/workflows/`，留待后续 PR。
