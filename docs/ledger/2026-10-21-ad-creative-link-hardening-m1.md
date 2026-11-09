---
id: 2026-10-21-ad-creative-link-hardening-m1
title: 广告素材补链第①块：把广告关联表改成只能经受保护入口写、签字有效性只有一处定义（迁移文件，未应用）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:2990
verify_by: 2026-10-28
verify_how: PR 合并前：看 PR 正文里的本机一次性数据库试跑记录（直接写被拒、已确认行不可改不可删、签字哈希对不上被拒）。迁移应用线上必须 PM 授权，应用后跑迁移末尾的断言并确认 4 条老行 link_source 为 backfill_pre_hardening。
---
A 级草稿 PR，只含迁移文件与设计稿副本，不含应用代码接线；迁移应用须 PM 授权。工单哈希列由后续块让出片管道写入。
