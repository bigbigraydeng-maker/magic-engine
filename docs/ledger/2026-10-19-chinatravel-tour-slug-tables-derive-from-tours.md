---
id: 2026-10-19-chinatravel-tour-slug-tables-derive-from-tours
title: 官网手写 slug 表改读 tours，并加固下架登记表（字段校验、301 可配、前缀碰撞、接口带下架标记）
status: decided
owner: agent
decided_on: 2026-10-19
source: session:ec90bb17
verify_by: 2026-11-06
verify_how: upgradedTourSlugs、CARD_MEDIA、MAP_SLUGS、DEPARTURE_IMAGE_OVERRIDE、destination-hubs 的 tourRefs、experiences.json 映射里的 slug 要么从 tours 派生，要么有「必须存在于 tours」的测试；登记表有完整字段校验；/api/internal/tours 返回已下架标记
---
这是 Christmas 下架暴露的结构问题：推广一个团会散落到多处手写表，下架时漏一处就残留。长期以团目录为唯一来源，见 docs/specs/2026-10-14-tour-catalog-website-alignment-onepager.md。
