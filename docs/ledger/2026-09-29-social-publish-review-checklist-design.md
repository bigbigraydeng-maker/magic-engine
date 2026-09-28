---
id: 2026-09-29-social-publish-review-checklist-design
title: 社媒发布前置检查清单要焊进 Kernel 审批，不能只是自由文本——PM 点名苏东坡+子牙设计
status: decided
owner: agent
decided_on: 2026-09-29
source: session:851f5d23
verify_by: 2026-10-06
verify_how: 查设计文档是否已定稿（子牙+苏东坡出稿、魏征挑刺过一轮，结论回小秘书转 PM）；没定稿就交回子牙/PM 排期，不默认在做
---
触发：Eastinter 两条宣传视频无声音、价格数据来源不明，全链路没人真正核实就要发布，是 PM 主动要求看成片才抓到（见记忆 feedback-reel-selfcheck-missed-no-audio）。PM 要求给社媒内容加一套跟广告支柱同等严格的 Kernel 授权+熔断+审计机制。设计基于 docs/specs/2026-09-28-pillar-agents-capability-memory-kernel-v0.1.md §4.3 现有架子往下细化：`CampaignDailyPostReviewDecision`（src/lib/campaign/daily-plan.ts:112）扩结构化 checklist 字段而非新建一套；`reviewed_by_user_id` 加"审核人≠生产者"校验；熔断补一条发布前信号（同一生产来源 N 天内≥2 次基础可用性检查不过）。子牙负责 Kernel 接线，苏东坡负责内容检查项 schema（A 基础可用性/B 事实grounding/C 爆款配方与红线/D 发布铁律四类），魏征挑刺。PM 明确"不用抢时间，做扎实"，设计定稿前不写实现代码。
