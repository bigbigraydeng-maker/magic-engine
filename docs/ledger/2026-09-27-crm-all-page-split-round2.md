---
id: 2026-09-27-crm-all-page-split-round2
title: 「全部客人」页第二轮拆分：抽屉内容搬进 ContactDetail.tsx，主文件 1081 → 709 行，回到 800 线以内
status: failed
owner: agent
decided_on: 2026-09-27
source: session:5b9407a2
done_on: 2026-09-27
done_ref: pr:2089
verify_by: 2026-10-01
verify_how: 跑 `wc -l "src/app/dashboard/clients/[id]/crm/all/page.tsx"` 必须 < 800。另跑 `npm test -- all/__tests__`，除既有那 3 条 nal-mark-won-panel 失败（基线 21e7675b 同样失败、同样行号 71/83/109、同样报 Jordan Example 找不到）之外全绿
verified_ref: doc:docs/ledger/evidence/2026-09-27-crm-all-page-split-round2--2026-10-10.md
last_checked: 2026-10-10
check_note: 本地实测主文件 971 行，不满足 < 800，回归失败；需开新卡做第三轮拆分
---
纯搬家，一行逻辑没改：`ContactDetail` 和只有它用的两个面板（`MarkWonPanel` / `ImportantMarkerEditor`）连同 `NAL_CLIENT_ID` 常量，一起搬进 `all/_components/ContactDetail.tsx`。搬前搬后那 372 行**逐字比对一致**（除了给三个组件加 `export`）。

为什么这一轮必须做完，不能再往后推：
- R6 第一轮把这个文件从 1034 拆到 867，接着 R7 加分段视图推到 965、修复轮再推到 1081 —— **两轮把上一轮的进度全吐回去还超出更多**。魏征复审点名了这个趋势：R6 那张卡的标题冻结在「拆到 867 行」，看卡的人不会知道它又长回去了。
- PM 2026-09-27 要把详情改成抽屉式弹出（调研了 HubSpot / Salesforce / Pipedrive / Intercom / Front / Close / Attio / Freshsales 八家，业界共识是列表旁边弹侧栏 + 「上一条 / 下一条」）。那一轮动的就是这一块，它跟主表挤在同一个文件里，改抽屉必然跟分段视图的行渲染撞车。

验证时先踩了一个自己的坑：第一版比对脚本用大括号配平找函数体，结果停在参数解构那对括号上，只比了 5 行签名就报「逐字一致」。改成整段切片比对才是真的。**校验工具本身也会「绿错」。**
