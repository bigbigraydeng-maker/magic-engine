---
id: 2026-09-28-playbooks-migration-pr-created
title: 8 份经验手册搬进仓库 + CI 格式检查 + agent 手册路径更新，草稿 PR 已建
status: done
owner: agent
decided_on: 2026-09-28
source: session:506aecf3
done_on: 2026-09-28
done_ref: pr:2158
verify_by: 2026-10-05
---
PR2：把 SEO / GEO / 社媒 / 广告 / 口碑 5 个支柱共 8 份经验手册从开发者记忆搬进 docs/playbooks/，
每份按 §3.2 格式脱敏（去客户名、账号、10 位以上数字），加 inbox.md 候选区。
CI 格式检查脚本 scripts/playbook-check-format.sh 8/8 通过。
CLAUDE.md 手册路径已改指仓库；三份 agent 手册（孔子/苏东坡/孟子）第 44 行已更新。
草稿 PR #2158，HEAD 91b10a64，等子牙三方审。
verify_by 验证项：子牙审过 → 转正 → PM 批合。
