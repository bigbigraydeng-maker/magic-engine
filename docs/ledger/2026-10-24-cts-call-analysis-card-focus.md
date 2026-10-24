---
id: 2026-10-24-cts-call-analysis-card-focus
title: CRM 通话分析默认突出出行与跟进，详细内容折叠并按需读取
status: done
owner: agent
decided_on: 2026-10-23
source: doc:docs/ledger/2026-10-23-cts-call-analysis-evidence.md
verify_by: 2026-10-31
verify_how: 在获准样本的 CRM 时间线核对出行时间、跟进安排和客户邮箱默认可见，摘要与转写默认折叠，展开后才读取转写
done_on: 2026-10-24
done_ref: doc:src/app/dashboard/clients/[id]/crm/_components/CallAnalysisCard.tsx
---
通话卡片默认展示客户核心出行诉求、跟进安排与电话中确认的邮箱；分析细节和转写折叠，转写按需读取。
本次改动尚未合并部署；历史已完成分析不自动重跑。
