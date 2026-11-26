# 证据 · 2026-09-27-merge-gate-three-prs-post-merge-probes · 2026-11-16
fetched_at: 2026-11-16T22:34:04+1300
查了什么：按 verify_how，三张子卡（配置密钥判 A、当场试跑、自报风险级）在主干 origin/main(def329639) 的状态，以及各自 verified_ref 指向的证据文件是否存在。三张子卡由 PR 2109 的改动文件列表确定（gh pr view 2109 --json files，PR 已合并 2026-09-28T14:06Z）。
数字（样本 3/3）：
- 2026-09-27-risk-gate-config-secret-files-a：status verified；证据 docs/ledger/evidence/2026-09-27-risk-gate-config-secret-files-a--2026-09-27.md 存在（1124 字节）
- 2026-09-26-immediate-trial-run-rule：status verified；证据 docs/ledger/evidence/2026-09-26-immediate-trial-run-rule--2026-09-27.md 存在（1333 字节）
- 2026-09-27-declared-risk-parse-missed-a：status verified；证据 docs/ledger/evidence/2026-09-27-declared-risk-parse-missed-a--2026-09-27.md 存在（1280 字节）
来源/命令：grep '^status:' / '^verified_ref:' docs/ledger/<id>.md；test -s <证据路径>；gh pr view 2109 --json files,mergedAt
结论：成——三张子卡都是 verified，证据文件都在且非空。
