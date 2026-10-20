---
id: 2026-10-20-content-gate-pr1-server-safe-surface
title: 内容实质闸第一步（服务端安全面）：标成「素材」的工单不能通过、不能发布
status: done
owner: agent
decided_on: 2026-10-20
source: session:106
verify_by: 2026-10-27
verify_how: 本 PR 合并后：①在测试里确认 asset_only 工单 approve 返回 409、发布兜底置终态不排重试、周概览不显示；②第二步（出片机内容闸）与第三步（服务端重算+界面+必填新清单项）仍待做，见 2026-10-18-content-substance-gate；翻「缺内容闸结果就拒收」开关前要读回出片机 capabilities=content_substance_v1
---
对应设计稿 docs/specs/2026-10-18-content-substance-gate-design.md §10.3、§11。PM 10-20 回「开始」。本步只做服务端安全面：`brief.remotion.deliverable === 'asset_only'`（严格相等，拼错按成片）的工单在 applyApprove(409)、Airtable 通过路径、发布兜底（终态失败）、YouTube 暂存入口四处被拦；周概览在 SQL 里过滤；完成回执新增 `content_substance`/`capabilities` 两个**仅记录**字段（无消费者，不做拦截）。有意推迟到第三步：V3 清单与 `checklist_version`（没界面时无效果）。已知遗留（子牙/魏征复核）：asset_only 目前仍会进审片队列、写入端的枚举校验待有写入方时补。
