---
id: 2026-10-17-crm-payments-party-size-118
title: CRM 收款进度页补「人数」：每个出发日、合计行、客人名单都能看到，没填的不当 0
status: done
owner: agent
decided_on: 2026-10-17
source: session:ccc90b3d
verify_by: 2026-10-20
verify_how: 合并上线后打开 CTS 收款进度页，Best of China 2027-03-11 那行应显示「15（另 1 单未填）」，2026-11-03 那行「8（另 3 单未填）」；点“看名单”每位客人旁有人数，没填的显示未填
done_on: 2026-10-17
done_ref: pr:2763
---
PM 10-17 提需求，统筹 18 号转述并确认判级 B。只改展示与接口返回字段，不改库、不涉金额；守卫测试只放开 partySize。
