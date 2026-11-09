---
id: 2026-09-26-crm-priority-route
title: 全部客人接口接上 4 段跟进视图（?view=priority），今日待办的直达链接不再落空
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 合并部署后请求 GET /api/clients/<CTS>/crm/contacts?view=priority —— 四段人数相加应等于该客户联系人总数；再带上 ?contact=<任一 CTS 联系人 id>，focus.found 应为 true 且报出他在哪段第几页。两条都成立算成
---
新增 view=priority 一条读路径：stage/q 筛选仍落 SQL，筛选后的子集在内存里算分段（分段依赖「现在几点」，SQL 里算不了）。响应形状 {view, focus, columns, sections[4]}；老的平铺和分页两条路径一字未改。
顺带收掉一处重复：responseRowFor 抽出来后，assembleRows 里那份就地拼装的同样行形状被删掉——原来两个入口各有一份，正是这轮要消灭的漂移。
已知代价：触点仍按 client_id 整批拉（跟老路径一样），没按筛选后的人收窄；CTS 约 5k 行 1.4MB，跟今天页每次打开的量相同。收窄要按 100 个 contact_id 一批走 .in()，留作后续。
顺带发现（不在本轮范围）：nal-mark-won-panel 那 3 个测试在干净主干上就是红的，已另开任务卡。
