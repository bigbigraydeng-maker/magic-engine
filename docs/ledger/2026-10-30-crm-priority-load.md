---
id: 2026-10-30-crm-priority-load
title: 优化今天先联系名单的读取与计时
status: decided
owner: agent
decided_on: 2026-10-30
source: doc:docs/specs/2026-10-26-crm-list-ssr-design-v0.md
verify_by: 2026-11-06
verify_how: 比较相同账号和筛选条件的页面耗时及名单人数顺序，确认接口分段计时可读且跟进判断不变。
---
名单读取保留完整判断依据，并行独立请求，减少无需使用的字段传输。
