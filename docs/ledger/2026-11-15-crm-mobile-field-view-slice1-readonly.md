---
id: 2026-11-15-crm-mobile-field-view-slice1-readonly
title: 手机外勤页第 1 刀（只读「今天要联系」名单，没有任何按钮）上线后，PM 用自己手机打开看一遍
status: decided
owner: pm
decided_on: 2026-11-15
source: session:96dc6edf
verify_by: 2026-11-18
verify_how: 合并上线后，PM 用自己手机打开 /dashboard/clients/<CTS客户id>/crm/field（登录后）：①10 秒内看到「客人在等你 / 还没搭上话」两栏和人数；②每个人有一句为什么今天要联系；③没有任何会打电话或改数据的按钮；④手机上字够大、不用横向滑。哪项不对，把截图发回 76 号窗口再改
---
设计稿 docs/specs/2026-11-15-crm-mobile-field-view-design-v0.md 第 1 刀。只复用 GET crm/today，不新增接口和表。PM 看完回「第 2 刀」才加打电话按钮。
