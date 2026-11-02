---
id: 2026-11-01-meta-leads-sync-every-30-min
title: Facebook 表单同步从每 2 小时改成每 30 分钟
status: done
owner: agent
decided_on: 2026-11-01
source: session:ea8633a9
verify_by: 2026-11-02
verify_how: 合并后调度是每小时 25 分和 55 分；下一轮 cron_run_logs 有收尾记录；同一条表单不会插进两次；回传开关保持关闭。
done_on: 2026-11-01
done_ref: pr:3505
---

表单同步仍走现有调度器，不改 Render 配置、不改回传开关、不加表。
重叠的一轮让路，线索仍按表单编号去重。限流最多重试三次，单次等待不超过 8 秒。
水位线仍回看 24 小时，失败的一轮不会把窗口收窄。
主干页面没有「每 2 小时同步」的文案；未合并的广告健康页分支另记。
回退：把调度改回 `25 */2 * * *`。
