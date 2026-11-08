---
id: 2026-11-04-factory-studio-mirror-daily-sync
title: 出片机读的本机素材镜像每天早上 8 点自动从 Dropbox 补齐一次（PM 定不用高频），装上后当场跑一次看结果
status: decided
owner: agent
decided_on: 2026-11-04
source: session:369fcc9e
verify_by: 2026-11-10
verify_how: 看 ~/Library/Logs/magicengine-studio-mirror-sync.log 里最近 7 天每天至少一条 studio_mirror_sync 记录且 failed 为 0、source_failed 为 0；再跑 node scripts/factory-worker/tools/sync-studio-mirror.mjs --check 退出码 0 算成。日志里一条都没有 = 定时任务没装上或没跑，先 launchctl print gui/$(id -u)/com.magicengine.studio-mirror-sync 看状态。
---
替代 2026-11-03 那张「每 5 分钟」的卡（工具本身在 pr:3565 合并）。PM 2026-11-04 说不用这么高频，每天甚至每周都行，定成每天一次：跑一次约 1 秒，不花钱、不联网。
当天急用刚放进 Dropbox 的素材，手动跑一次 --apply。
