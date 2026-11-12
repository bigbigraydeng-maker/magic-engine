---
id: 2026-11-02-pr-patrol-code-replaces-grok
title: PR 巡查改用代码跑（只读），不再靠频繁唤醒 Grok；工作流文件待有权限的人放进 .github/workflows
status: decided
owner: agent
decided_on: 2026-11-02
source: issue:3478
verify_by: 2026-11-09
verify_how: 工作流放好后手动触发一次（dry_run）看到运行成功；一周内 #3087 只有一条被原地更新的巡查评论，无变化时没有新评论
---

Ray 2026-11-02 确认先做 PR-1。脚本 `scripts/ci/pr-patrol.mjs` 和测试已写好；
工作流模板在 `docs/sops/pr-patrol-workflow.yml`（机器人无权直接写 `.github/workflows`）。
