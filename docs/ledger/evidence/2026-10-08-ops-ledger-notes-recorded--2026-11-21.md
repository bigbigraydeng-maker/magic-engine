# 证据 · 2026-10-08-ops-ledger-notes-recorded · 2026-11-21
fetched_at: 2026-11-21T08:04:07+1300
查了什么：两张被补正文的卡里那两句话还在不在；通知邮件（proposal-view-digest）的发信记录。
数字（带样本量、两边取数状态）：取数成功。docs/ledger/2026-10-07-proposal-digest-sandbox-sender.md 第 13 行写着「PM 选择管理员合，免三位审查签字」；docs/ledger/2026-10-07-comment-reply-missing-manage-engagement-scope.md 第 13 行写着「未验证：Meta 应用本身是否已获批 pages_manage_engagement」。生产库 proposal-view-digest 运行记录：失败 7 条（最后一条 10-03），之后成功 109 条，其中 2 条 email_sent=true，最近一条 11-21 08:00（新西兰）。
来源/命令：git 主干 cc3c9b307 上 grep 两张卡；Supabase 只读 SQL（cron_run_logs job_name=proposal-view-digest）。
结论：成。两句说明都在卡里；通知邮件系统侧记录为已发出 2 次。收件箱里是否真收到没登录邮箱看，只到系统发信记录为止。
