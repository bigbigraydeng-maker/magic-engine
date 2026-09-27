---
id: 2026-09-27-application-build-check-not-tamper-proof
title: Application build / Kernel architecture test 用 pull_request 触发，跑的是 PR 自己那份 workflow——今天不是防篡改的
status: decided
owner: agent
decided_on: 2026-09-27
source: pr:2104
verify_by: 2026-10-04
verify_how: 检查 pr-application-validation.yml、kernel-architecture.yml 等必过检查的 workflow 是否已换成不检出/不执行 PR head 代码的独立身份出状态方案（例如无写权限的 GitHub App/机器人身份）；不得用 pull_request_target 直接 checkout PR head 构建——那会把 PR 可控的依赖脚本和测试代码放进拿到 base 分支 token/cache 的受信上下文执行，是新的供应链风险，不是修复；未改则维持 decided
---
Codex 审查发现：这几道 Protect main 必过检查用 `on: pull_request`，执行的是 PR 分支自己
那份 workflow 定义。PR 只要在同一次改动里把构建步骤换成必然成功的空壳、保留检查名不变，
产出的绿勾仍来自同一个 `integration_id`，规则集分不出真假。这类改动会因碰了 `.github/`
被判 A 级，但今天 A 级合并靠 PM 聊天里说一句 go，机器判不出 PM 是否看穿了 diff 里的猫腻。
已在 `.github/merge-authorization.md` 的「已知缺口」如实记录；真正修复**不能**照搬
`pr-risk-gate.yml` 那种 `pull_request_target` + checkout PR head 的做法——`pull_request_target`
的安全边界是判官的定义和代码都来自 main、绝不检出或执行 PR head（见 `pr-risk-gate.yml` 顶部
注释、`docs/specs/2026-09-25-merge-gate-two-tiers-design.md` §3.1），而构建/测试检查恰恰要跑
PR 自己的依赖安装和代码，若在 `pull_request_target` 里检出 PR head 来构建，等于把 PR 可控的
脚本放进拿得到 base 分支 token/cache 的受信上下文执行，反而制造新的供应链攻击面。可行方向是
换一个不执行 PR 代码的独立身份出状态（例如无写权限的 GitHub App/机器人身份），这需要改
`.github/workflows/`，这次改动范围不含，留待后续 PR。
