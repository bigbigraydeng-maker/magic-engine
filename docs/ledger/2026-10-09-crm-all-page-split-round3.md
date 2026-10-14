---
id: 2026-10-09-crm-all-page-split-round3
title: 「全部客人」页第三轮拆分：表头/表行/筛选条/翻页/同行批量邮件搬进 _components，主文件 971 → 714 行，回到 800 线以内
status: done
owner: agent
decided_on: 2026-10-09
source: session:4d4d7a49
done_on: 2026-10-09
done_ref: pr:2386
verify_by: 2026-10-13
verify_how: 跑 `wc -l "src/app/dashboard/clients/[id]/crm/all/page.tsx"` 必须 < 800。另跑 `npm test -- all/__tests__`，应 3 个文件 39 条全绿（本轮实测 nal-mark-won-panel 那 3 条旧失败这次也过了，原因未追查，别当成修好了）
---
接 2026-09-27-crm-all-page-split-round2（夜巡 2026-10-06 判 failed：之后 WP-B2/B3/B5 加功能又把主文件推回 971 行）。

纯搬家，行为不变：新增 5 个同目录文件，页面只留状态、取数、抽屉导航这些要互相牵连的逻辑。
- `ContactTableRow.tsx`（一行客人）· `ContactTableHead.tsx`（表头）
- `ListFilters.tsx`（搜索框 / 阶段筛选 / 分段切换 / 终端客户·同行 + 同行批量邮件面板）
- `ListPagination.tsx`（平铺翻页 + 分段内翻页行）
- `list-helpers.ts`（isToday / toDrawerRow / sectionRange / PrioritySectionData）

第二轮那张卡的教训仍成立：拆完不等于不会再长。下次再往这页加功能，先加到 `_components`，别直接加进 page.tsx。
