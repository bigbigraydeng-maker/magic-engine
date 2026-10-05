# 证据 · 2026-09-27-merge-gate-three-prs-post-merge-probes · 2026-10-05
fetched_at: 2026-10-05T22:00:00+1300
查了什么：三张关联卡的 status，以及各自证据文件是否存在
数字：risk-gate-config-secret-files-a、immediate-trial-run-rule、declared-risk-parse-missed-a 三张均为 verified；evidence 下各有 `--2026-09-27.md` 文件
来源/命令：grep -E "^status" 三张卡；ls docs/ledger/evidence | grep -E "risk-gate-config|immediate-trial|declared-risk"
结论：成。本地只读文件即可满足 verify_how，不需要生产库或外网。
