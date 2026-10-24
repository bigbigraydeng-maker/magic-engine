---
id: 2026-10-24-disable-factory-sweepers-github-schedule
title: 出片卡住的自动收回从 GitHub 搬到服务器，每 10 分钟跑一次。新定时任务要亲手填上和网站一样的密钥，否则每次都会被拒绝
status: done
owner: agent
decided_on: 2026-10-24
source: doc:.github/workflows/factory-sweepers.yml
verify_by: 2026-10-31
verify_how: 合并后在 Render 给 factory-worker-sweeper 填上和网站一样的 CRON_SECRET，看它第一次运行成功，运行记录里有这个任务名。没填密钥会一直被拒绝。
done_on: 2026-10-24
done_ref: pr:3070
---
出片工单心跳超过 10 分钟还停在领取中或制作中，改由服务器每 10 分钟打原来的接口退回排队。
GitHub 上每 5 分钟的自动跑已去掉，手动运行还留着。
新的服务器定时任务不会自动带上密钥。合并后要在 Render 里给 factory-worker-sweeper 填上和网站一样的 CRON_SECRET。
本环境建不出那台新任务，第一次真正跑通要等合并并且密钥填好。
