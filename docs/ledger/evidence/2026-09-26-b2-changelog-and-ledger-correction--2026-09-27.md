# 证据 · 2026-09-26-b2-changelog-and-ledger-correction · 2026-09-27
fetched_at: 2026-09-27T03:52:51+13:00
查了什么：主干（origin/main d33b5ef2）上 CHANGELOG 是否有 2026-09-25 B2 条目；台账卡 fix-manual-items-syntax 正文事故归因写的是不是 #2016。
数字（带样本量、两边取数状态）：两处文件都读到（取数成功）。docs/history/CHANGELOG.md 第 91 行「### 2026-09-25（B2 三只闹钟上线：司马迁口碑周巡 / 李白文案溯源 / 马良出片自检）」；docs/ledger/2026-09-25-fix-manual-items-syntax.md 第 16 行「#2016（李白）合并入 main 时冲突解决漏掉了…」，#2017 只作为「合并后问题延续」出现。
来源/命令：grep -n "2026-09-25" docs/history/CHANGELOG.md；grep -n "2016\|2017" docs/ledger/2026-09-25-fix-manual-items-syntax.md（在 origin/main 工作副本里跑）
结论：成——两条判据都在主干上满足。
