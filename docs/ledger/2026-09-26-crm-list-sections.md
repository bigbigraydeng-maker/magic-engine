---
id: 2026-09-26-crm-list-sections
title: 「全部客人」页 4 段视图的纯函数 lib/crm/list-sections 已就位；穷举断言防漏段消失
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 合并后由 R5 的路由测试 + 生产上 CRM 全部客人页的分段视图端到端验证；本轮只装配段结构，不接线
---
新建 src/lib/crm/list-sections.ts + 测试，把 today 页的 3 层 + 第 4 段「不在今天名单」用一个纯函数拼出来。段内排序：置顶在前、其余按 compareForWorklist。每段独立分页；未展开的段 items=null。SECTION_OF_SEGMENT 覆盖每一个 Segment，测试用 keyof SEGMENT_META 穷举断言——防 2026-08-02 那种漏段导致人凭空消失的事故重演。
下一步 R5 装 contact-list-view.ts 把 SQL + segmentContact 输出喂进本函数。
