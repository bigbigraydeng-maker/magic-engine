---
id: 2026-09-27-application-build-check-not-tamper-proof
title: Application build / Kernel architecture test 用 pull_request 触发，跑的是 PR 自己那份 workflow——今天不是防篡改的
status: decided
owner: agent
decided_on: 2026-09-27
source: pr:2104
verify_by: 2026-10-04
verify_how: 另开任务出修复设计，经子牙和魏征两审；设计必须说明为什么同一个 PR 改了 workflow 也改不了这几道必过检查的结论（不许在受信上下文执行 PR 代码，也不许只转发可伪造的结果）。没出设计就维持 decided
---
Codex 审查发现：这几道 Protect main 必过检查用 on: pull_request，执行的是 PR 分支自己那份 workflow。
PR 在同一次改动里把构建步骤换成空壳、保留检查名，绿勾照样出现，规则集分不出真假。
这类改动碰 .github/ 会被判 A 级、要 PM 点头，所以今天靠的是流程信任，不是机制保证。
缺口已写进 .github/merge-authorization.md「已知缺口」；修法不在这里预设，另开任务两审后定。
