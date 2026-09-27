---
id: 2026-09-27-risk-gate-config-secret-files-a
title: 密钥文件、忽略清单、构建配置、检查配置改动一律判 A 级，不再走无人自动合
status: done
owner: agent
decided_on: 2026-09-27
source: session:29a26321
verify_by: 2026-10-01
verify_how: 合并后在主干上对 .env.production / .gitignore / next.config.js / tsconfig.json / vitest.config.ts 各跑一次 classifyRisk，五个都出 A；且一个只改根目录 .gitignore 的真实 PR 的 Risk gate 显示 A 级、自动合并为关闭
done_on: 2026-09-27
done_ref: pr:2071
---
2026-09-27 在主干 33672dbe 实测：根目录 .env.*、.gitignore、next.config、tsconfig、vitest/playwright/eslint 配置、Dockerfile、.husky、.npmrc 等全判 B，而 B 自 2026-09-25 起无人自动合。
改 tools/ops-review-loop/src/risk.mjs 补规则；根目录 .env.example 仍是 B，docs 仍是 C，全仓没有任何文件被降级。
