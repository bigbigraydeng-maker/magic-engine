---
id: 2026-10-11-tour-catalog-draft-reads-paginated
title: 旅游产品目录读取改成分页，超过 1000 条出发日期不再被悄悄截掉
status: done
owner: agent
decided_on: 2026-10-11
source: session:1311c3c6
verify_by: 2026-10-14
verify_how: 合并后在页面/导出里确认出发日期条数与数据库一致；目前最大客户远不足 1000 条，所以是预防性修复，没有线上症状可对
done_on: 2026-10-11
done_ref: pr:2454
last_checked: 2026-11-20
check_note: PR 2454 已合并，主干 store.ts 三张表都用 range 分页；生产库出发日期最多的客户只有 47 条，远不到 1000；页面需登录，没法对页面条数，判不了
---
loadDraftCatalog 的 tours/departures/aliases 三个查询改用已有的 fetchAll 分页（每页 1000，带稳定排序）。
发布快照由数据库函数在库内汇总，不受影响。新增测试用模拟 >1000 行验证一条不丢。
