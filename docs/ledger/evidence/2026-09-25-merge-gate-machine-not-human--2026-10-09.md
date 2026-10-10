# 证据 · 2026-09-25-merge-gate-machine-not-human · 2026-10-09

fetched_at: 2026-10-09T21:55:28+13:00（夜巡工作副本，origin/main = b9a32592d）

查了什么：verify_how 的三条，逐条在主干代码与文档里实查。

数字（带样本量、两边取数状态）：
- 条件①「不再存在名为『合并审批（Ray）/ Merge authorization (Ray)』却无条件自动通过的检查」：
  `grep -rniE "name:.*(审批|authoriz)" .github/workflows/` 命中 0 处（扫 .github/workflows 全目录）。
  `.github/workflows/pr-risk-gate.yml:3` 注释写明它取代了旧的 "Merge authorization (Ray)"；
  `.github/merge-authorization.md:9` 写明旧检查已删除。→ 满足。
- 条件②「merge-authorization.md 写明各风险级由哪些机器检查放行」：该文件 §两档 表格（第 38-41 行）
  B/C 级 = `Risk gate` 绿后自动 `gh pr merge --auto --merge`；A 级 = 三方签字标记齐才绿、永不自动合。
  §主干规则集（第 62-84 行）逐条列出必过检查名。→ 满足。
- 条件③「A 级 PR 在复审签字有机器可读记录之前不自动合」：
  `.github/workflows/pr-risk-gate.yml:66` 的 "Enable auto-merge (B/C only)" 步骤条件是
  `steps.gate.outputs.decision == 'enable'`；第 76 行另有 "Disable auto-merge (A / draft / fork / undecided)"。
  判级脚本 `tools/ops-review-loop/src/check-risk-gate.mjs` 第 9-19 行写明不变式：
  只有 `decision.pass === true && decision.tier === 'auto'` 才写 enable，其余一切路径（含失败路径）写 disable；
  第 37 行 import `evaluateSignoffs / parseSignoffMarkers / selectTrustedSignoffMarkers`
  （来自 `./signoff-marker.mjs`），签字标记只认 `ME_SIGNOFF_TRUSTED_LOGINS` 里的可信身份。→ 满足。

来源/命令（均在 /private/tmp/ledger-verify-20261009，HEAD=b9a32592d6dbcdca033e70f36993d82919e6941f）：
- `grep -rniE "name:.*(审批|authoriz)" .github/workflows/`
- `grep -nE "^#|必过|A 级|Risk gate" .github/merge-authorization.md`
- `sed -n '50,90p' .github/workflows/pr-risk-gate.yml`
- `grep -n "signoff" tools/ops-review-loop/src/check-risk-gate.mjs`

结论：成。三条判据全部在主干代码与文档里实查到，人工「合并审批（Ray）」检查已不存在，
A 级自动合由机器可读签字标记把守且失败即红（fail-closed）。
