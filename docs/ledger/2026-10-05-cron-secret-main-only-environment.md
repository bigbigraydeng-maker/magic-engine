---
id: 2026-10-05-cron-secret-main-only-environment
title: 把线上定时任务密钥收进"只允许主干使用"的 GitHub 环境（现在任何有写权限的人推的分支都能读到）
status: decided
owner: pm
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-19
verify_how: GitHub 设置里存在只允许 main 的环境（含 CRON_SECRET），分支上的 workflow 读不到该密钥；既有 5 个用 CRON_SECRET 的 workflow 已迁到该环境
---
三位复审指出：仓库级 Secret 对任何有写权限的人推上来的分支 workflow 都可读，这一点早就存在（现有 5 个 workflow 在用），手动试跑入口没有放大它，但也没法收窄。
收窄需要有密钥明文的管理员在 GitHub 里建环境并迁移；开发窗口读不到密钥明文，做不了。
