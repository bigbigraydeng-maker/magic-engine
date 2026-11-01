---
id: 2026-11-01-ledger-card-body-limit-fix
title: 台账卡正文超过 5 行让主干检查变红，已压回 5 行
status: done
owner: agent
decided_on: 2026-11-01
source: session:96dc6edf
done_on: 2026-11-01
done_ref: pr:3452
verify_by: 2026-11-02
verify_how: 修复合并后，主干上「仓库里的真实台账条目全部合法」检查转绿，并且新 PR 不再因此变红
---
问题：#3445 带进主干的台账卡 crm-wp1a-data-errors 正文 8 行，超过 README 规定的 5 行，「仓库里的真实台账条目全部合法」检查在主干上变红，之后每个新 PR 都跟着红。
修法：只把那张卡的正文压成 5 行，前置字段一字未动。
教训：开草稿前要在本机跑一遍 npx vitest run src/lib/ledger，别只看审查员签字和相关测试。
