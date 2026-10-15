---
id: 2026-10-16-risk-protect-music-vocal-gate
title: 把音乐人声登记表和闸的接线点加进「必须 PM 本人批准」的受保护文件，防止别的小改动偷偷往里加签字
status: decided
owner: agent
decided_on: 2026-10-16
source: session:ec90bb17
verify_by: 2026-10-23
verify_how: 合并后任找一条只改 scripts/factory-worker/engines/remotion/catalog/music-vocals.json 的测试 PR，Risk gate 必须判 A；改 worker.mjs / remotion-branch.mjs / creative-recipe.mjs 同样判 A；engines/remotion/README.md 仍是 C。
---
背景：魏征复审 PR 2718 时实测，登记表与闸的文件都被判 B（会被机器自动合），而签字格式可被手写伪造。本 PR 把它们（及出片机三处接线点）列为 A 级。规则文件本身在 tools/ops-review-loop/，属 A，需 PM 回「合」。在本 PR 合并前，任何人不得往登记表加条目。
