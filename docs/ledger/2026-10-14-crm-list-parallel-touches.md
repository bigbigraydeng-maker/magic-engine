---
id: 2026-10-14-crm-list-parallel-touches
title: 名单接口提速：数据库函数给出这一页的 id 后，「读往来记录」与「取这些人的资料」同时开始，省约 0.17 秒；不缩小往来记录的字段
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2627
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 在 PM 的 Chrome 里读 Server-Timing：默认打开 total 比约 1.0 秒明显更低，page_rows 与 touches_briefs 两步合并成一步的耗时（约 0.5 秒）
---
PM 2026-10-14 回「开始提速」。实测拆解：往来记录 0.5 秒、取页 0.2 秒、鉴权 0.17 秒、取资料 0.17 秒。只做第 1 处（两步并行，不改任何结果）。第 2 处「缩小往来记录」我核查后没做：50 人共 505 条往来记录 313KB，去掉 raw 和 metadata 只省约 0.17 秒，而分段、结果重判、别再联系判断都要用这两个字段（metadata 里有十几种键），风险大于收益。
