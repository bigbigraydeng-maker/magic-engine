---
id: 2026-11-28-cts-welcome-script-first-real-run-after-fix
title: CTS 每天早上的欢迎信脚本加了「收过就跳过」，11-29 早上第一次真发要核一下成没成
status: done
owner: agent
decided_on: 2026-11-28
source: session:549c3648
verify_by: 2026-11-29
verify_how: "11-29 早上 8 点后查 contact_touchpoints（source=mailchimp、出站）：有没有活动名 auto_e1_batch_20261128 的发出记录（11-28 晚试跑时待发 10 人，人数应在 10 上下）；这些人里有没有谁 30 天内还收过别的 auto_e1_batch_ 活动，应为 0。记录要等 ME 当天傍晚同步后才有；没有时去 Mailchimp 活动列表看同名活动是不是 Sent。不成第一步：看表格脚本运行记录里 dailySendE1Batch 那次的报错文字，一句话告诉 PM；要退回旧版，把本机备份里的 Code.before.gs 贴回脚本保存"
done_on: 2026-11-28
done_ref: doc:docs/ledger/evidence/2026-11-28-cts-welcome-letter-sent-twice-on-1122--fix.md
---
PM 11-28 在本窗口回「修」。改的是 PM 谷歌账号里的表格脚本（不在本仓库）：发欢迎信前先问 Mailchimp 近 30 天谁已经收过同类批次，收过的跳过并在表格标记；读不到就整批不发并显示失败；发送被拒绝时不再留下带真实收件人的草稿。
两位独立复核员各审两轮，结论可以上线。本机不发信模拟和线上不发信试跑都通过（试跑：待发 10、会发 10、没发信没写表）。
正式发信那条路第一次自动运行是 11-29 早上 8 点，这张卡就是核这一次。
改了什么、复核意见、验证记录、回滚办法、已知局限都在 done_ref 那份文件里。
备份在本机 ~/.claude/window-discipline/backups/cts-welcome-script-2026-11-28/。
