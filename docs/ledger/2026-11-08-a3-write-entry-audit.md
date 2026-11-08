---
id: 2026-11-08-a3-write-entry-audit
title: 赢家同步和补素材只出卡，旧暂停入口仍能直接改广告
status: decided
owner: pm
decided_on: 2026-11-08
source: doc:docs/ledger/evidence/2026-11-03-ads-impact-25-packages-audit.md
verify_by: 2026-11-15
verify_how: 看证据清单。入口边界测试确认扫描和补素材文件不点名写入函数。赢家确认单测整文件加载失败，修模块之前不能把过期不写说成已测过。
---

A-3 不能整包标完成。定时扫描和补素材只出卡。确认后才建暂停广告，但过期卡的返回值没被拦住。旧的暂停和恢复入口仍直接改广告。

确认写入还指着已经删掉的暂停卡模块，这条路现在加载就会断。最小修法见证据清单，本批不改写入。
