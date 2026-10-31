---
id: 2026-10-31-crm-search-identities
title: 修复客人电话和邮箱搜索并减少搜索等待
status: done
owner: agent
decided_on: 2026-10-31
source: pr:3423
verify_how: 上线后分别搜索姓名、本地格式电话和主要及其他邮箱，核对分组结果与加载时间。
done_on: 2026-10-31
done_ref: pr:3423
---
搜索覆盖客户联系方式并限制读取范围，同时避免旧结果覆盖新搜索。
