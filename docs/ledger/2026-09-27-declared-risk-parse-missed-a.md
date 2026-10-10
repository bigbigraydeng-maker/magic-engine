---
id: 2026-09-27-declared-risk-parse-missed-a
title: 两个自报 A 级的 PR 因为写法机器认不出，被当成 B 级无人审就自动合并了；已放宽识别，读不懂的一律按 A
status: verified
owner: agent
decided_on: 2026-09-27
source: session:29a26321
verify_by: 2026-10-02
verify_how: 合并后开草稿探测 PR，正文分别写「## 风险级」下一行「**A 级**」、「风险级：A」、「风险级别：见下表」，改动只碰一个普通 B 级文件；三次 Risk gate 摘要都判 A，第三次理由里点名读不懂的那一行
done_on: 2026-09-27
done_ref: pr:2121
verified_ref: doc:docs/ledger/evidence/2026-09-27-declared-risk-parse-missed-a--2026-09-27.md
last_checked: 2026-09-27
check_note: 合并后探测 PR 2130 四种写法全判 A
---
2026-09-26：#2061 写「风险级：A」、#2075 写「## 风险级」下一行「**A 级**」，旧解析只认「风险级别/风险等级/risk level：字母」，都没读出，按改动文件判 B，自动合并，三方审一个没做（车道未启动，无实际危害）。构建控制复查 09-25 以来 39 个自动合并 PR，只有这两个。
修法：tools/ops-review-loop/src/risk.mjs 的 readDeclaredRisk；统一写法仍是「风险级别：A」。
同类写法还开着的 #2027、#1703、#1932、#1934 已由子牙转草稿、关自动合并；本修复合并后恢复（转回可审、重开自动判级）由小秘书挂在运维台账，P3 待认领。
