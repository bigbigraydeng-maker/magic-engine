---
id: 2026-10-18-sidebar-regroup-118
title: 管理员左栏重排成 5 组，低频两组默认折叠，去掉死页 analytics 入口
status: done
owner: agent
decided_on: 2026-10-18
source: pr:2799
verify_by: 2026-10-21
verify_how: 登录后台看左栏：上面三组展开，「账务与客户管理」「系统与诊断」折叠，点开能看到原来的页面；打开其中一页（如 /dashboard/admin/cron-health）时所在组自动展开；左栏没有 Analytics
done_on: 2026-10-18
done_ref: pr:2799
---
PM 10-18 冻结令：优先简化功能；统筹 18 号转述「左栏重排（5 组、低频折叠）」属于简化本身。
analytics 页读的接口本仓库不存在，是死页，入口去掉；页面与网址未动。
左栏同时拿掉 billing-monitor 入口（页面保留）：它读的成本表 5 月后无新数据，写入函数无人调用。
后续事项（冻结期不做，由统筹 18 号记入闭环清单候选）：ME 目前没有任何在写入的 API 成本账本，月报成本段 6–10 月为空，需要时先接 logServiceUsage。
