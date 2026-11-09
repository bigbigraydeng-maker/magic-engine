---
id: 2026-10-26-viral-analyzer-retry-rotation
title: 爆款视频分析别反复重试同一批失败，真失败要记进运行记录
status: done
owner: agent
decided_on: 2026-10-26
source: session:9c08a71c
verify_by: 2026-11-02
verify_how: 迁移应用并部署后看三件事：viral-analyzer-worker 的 cron_run_logs 里 failed_count 等于当次真正没分析成的条数（不再恒为 0）；viral_reference_library 里 analysis_status=error 的行 updated_at 在轮换（不再总是同最早 4 条）；PROHIBITED_CONTENT/No video formats found/小红书行变成 terminal 不再被领取。迁移未应用前不要部署新代码。
done_on: 2026-10-26
done_ref: pr:3174
---
Grok Bot #3074 等价（原 PR 已关，决策见 2026-10-26-close-grok-cron-prs-rewrite-on-current-main）。
问题：定时任务每轮只领最早 4 条失败行，同一批反复重跑；analyzeViralReference 把错误吞掉，任务记录写成全部成功。
修法：新增 analysis_attempts / next_retry_at / updated_at 与 terminal 状态；暂时性失败指数退避，永久失败直接 terminal，重试按 updated_at 轮换，错误抛回让 failed_count 真实。迁移只进仓库，不自动应用；顺序是先应用迁移、再部署代码。
