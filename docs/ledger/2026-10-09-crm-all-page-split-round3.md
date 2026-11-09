---
id: 2026-10-09-crm-all-page-split-round3
title: 「全部客人」页第三轮拆分：表头/表行/筛选条/翻页/同行批量邮件搬进 _components，主文件 1027 → 756 行，回到 800 线以内
status: done
owner: agent
decided_on: 2026-10-09
source: session:4d4d7a49
done_on: 2026-10-09
done_ref: pr:2615
verify_by: 2026-10-13
verify_how: 跑 `wc -l "src/app/dashboard/clients/[id]/crm/all/page.tsx"` 必须 < 800。另跑 `npm test -- all/__tests__`，应 3 个文件 50 条全绿
---
接 round2（夜巡 10-06 判 failed：功能加多又长回去）。纯搬家，行为不变；主干 10-14 又改了此页，已在最新主干上重做。
新增同目录 5 个文件：ContactTableRow / ContactTableHead / ListFilters（含同行批量邮件面板）/ ListPagination / list-helpers.ts。
页面只留互相牵连的状态、取数、抽屉导航。
教训：拆完不等于不会再长。以后往这页加功能，先加到 `_components`，别直接加进 page.tsx。
