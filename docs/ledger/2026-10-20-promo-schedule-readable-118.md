---
id: 2026-10-20-promo-schedule-readable-118
title: 推广计划页「排期表·每天做什么」改成可读：只展开本周+下周、日常合并成表头一句、每天一行
status: done
owner: pm
decided_on: 2026-10-20
source: session:ccc90b3d
verify_by: 2026-10-23
verify_how: 打开 /dashboard/clients/<id>/promo-plan：排期表默认只展开本周和下周，更远的按周折叠成一行小结；帖子/快拍不逐日列，「需要 PM 另行批准」只在表头出现一次；手机宽度不横向滚动
done_on: 2026-10-20
done_ref: pr:2942
---
PM 10-20 原话「排期表·每天做什么 可读性不行，文字太多」，经统筹 18 号转述。只改展示（新增纯函数 schedule-view.ts + 重写 ScheduleTable 渲染），不改计划数据与排期逻辑。改前真实页面 165 行；改后页面需部署后核对。
