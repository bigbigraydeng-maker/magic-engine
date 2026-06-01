# Render 部署指南（已过时）

> ⚠️ **此文档已过时，仅供历史参考**
>
> 当前部署架构以 `render.yaml`（Blueprint）为准——一切 service、cron、env vars 都从那个文件自动同步。
>
> 该文档原本描述的 `magic-engine-tasks` background worker + `scripts/process-tasks.js` + `/api/cron/process-tasks` 是 Phase 0/1 早期方案，**端点从未真正实现**，于 2026-06-01 全部删除。
>
> 后续后台任务统一走 Render Cron Jobs（见 render.yaml 中 `type: cron` 条目）：
> - vision-analyzer（每 2 分钟）
> - poll-visual-jobs（每 2 分钟）
> - site-audit-cron（每天）
> - attribution-cron（每 6 小时）
> - zhangqian-sweeper（每 5 分钟）
> - blog-stuck-generating-sweeper（每 5 分钟）
> - ai-tracker-weekly（每周一）
> - keyword-snapshots-weekly（每周一）
> - 等等…
>
> **正确部署流程**：
> 1. 在 Render 控制台用 Blueprint 指向 `main` 分支
> 2. Render 自动从 `render.yaml` 读取并创建/更新所有 service
> 3. 标了 `sync: false` 的环境变量（API keys、CRON_SECRET 等）每个 service 手动填一次即可
