---
id: 2026-09-28-playbooks-risk-classification-a-level
title: docs/playbooks 正文判 A 级、inbox.md 判 C，判级规则已合进主干
status: done
owner: agent
decided_on: 2026-09-28
source: session:506aecf3
done_on: 2026-09-28
done_ref: pr:2153
---
PR1：在 risk.mjs 加一条正则把 docs/playbooks 正文判 A（治理文件），inbox.md 候选区判 C（自动合）。
裸路径 symlink 防御 + macOS 大小写不敏感防御（狄仁杰实测）。
子牙签字 4d36f683、PM 同意合并、merge commit a3ffe259。
