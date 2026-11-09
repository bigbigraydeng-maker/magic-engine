---
id: 2026-10-14-crm-contacts-page-function
title: 全部客人提速：新增只读数据库函数，一次返回「这一页按最近真实互动排好的客人 + 总数」，代码先调函数、没装或出错就退回老路径
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2594
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 迁移应用后，在 PM 的 Chrome 里量名单接口：默认打开与搜索都明显快于现在的约 2 秒；排序与搜索结果和函数上线前一致
---
PM 2026-10-14 回「批准提速库」。只新增一个只读函数 crm_contacts_page_by_latest_touch（不改表、不改数据），沙盘 17 项检查全过，4 种故意破坏都被抓到；用生产的结构（只有编号和时间，没有姓名电话）灌进沙盘，前 500 位每个位置的最新互动时间与应用层参考实现完全一致（同一时刻的并列人顺序不同，属并列）。迁移的应用与代码合并都要 PM 说「合」。
