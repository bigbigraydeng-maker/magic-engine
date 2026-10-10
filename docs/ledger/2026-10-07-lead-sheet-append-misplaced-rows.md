---
id: 2026-10-07-lead-sheet-append-misplaced-rows
title: CTS 留资总表被机器写错位置：新行越写越靠右，同样 5 条线索每小时重写一遍
status: decided
owner: agent
decided_on: 2026-10-07
source: doc:docs/audits/2026-10-07-cron-data-readers-audit.md
verify_by: 2026-10-08
verify_how: 合并后等整点 20 分那次同步，只读那张表：最后一行必须从 A 列开始，且同样的线索不再每小时重写（回执里 appended 降为 0）
---
根因：追加行时让 Google 自己找表尾，表中间有空行后它把行推到第 695 列，判重永远认不出。
修法：改成按工作表末尾从 A 列写入。表格底部已有 702 行垃圾行，清不清由 PM 决定，不碰。
10-08 已清理：错位行共 718 行（一行空行加 717 行错位行）已删，表从 1569 行变 851 行，正常线索一条没少。
备份页签（隐藏）：https://docs.google.com/spreadsheets/d/1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA/edit#gid=821401505
清理后试算：窗口内 164 条全在表里，要补写 0 行。
