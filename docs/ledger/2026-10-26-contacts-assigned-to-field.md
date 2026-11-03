---
id: 2026-10-26-contacts-assigned-to-field
title: 第二刀 part 1：contacts 加 assigned_to 字段
status: decided
owner: pm
decided_on: 2026-10-26
source: session:aedf9b5a
verify_by: 2026-11-02
verify_how: migration apply 后，psql 查 \d contacts 能看到 assigned_to text 列且带 contacts_client_assigned_idx 索引
---
PM 10-26 选方案 A。字段挂 contacts 不挂 conversations（原因见迁移文件头注释）。本 PR 只加字段，round-robin 逻辑和 UI 在后续子刀。
