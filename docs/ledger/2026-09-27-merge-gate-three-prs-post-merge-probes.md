---
id: 2026-09-27-merge-gate-three-prs-post-merge-probes
title: 合并闸三个修复（配置密钥判 A、当场试跑闸、自报风险级识别）合并后都开真实探测 PR 验过，三张卡翻成已验证
status: done
owner: agent
decided_on: 2026-09-27
source: session:29a26321
verify_how: 三张卡（配置密钥判 A、当场试跑、自报风险级）都是 verified，且各自的证据文件在 docs/ledger/evidence/ 下能打开
done_on: 2026-09-27
done_ref: pr:2109
last_checked: 2026-10-05
check_note: 10-05 夜巡未核查本卡判据（夜巡只有本地只读权限，无生产库、登录态或外网），待人工或下一轮核查
---
探测 PR：#2101-2103（配置文件判 A）、#2106-2108（当场试跑：缺段红 / edited 补段绿 / 出口绿）、#2130（自报风险级 4 种写法全判 A）。全部已关闭、分支保留。
做法沿用：草稿 PR 探判级；要看试跑那一步用非草稿 + 故意不合规台账卡保证合不进。
