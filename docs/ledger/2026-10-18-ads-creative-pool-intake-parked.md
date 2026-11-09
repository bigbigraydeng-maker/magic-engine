---
id: 2026-10-18-ads-creative-pool-intake-parked
title: 「已发布成片自动登记成素材候选」写完两审后撤掉，不合；正确判据和五处必改记在这里给后来人
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-18
verify_how: 若 97 号把那批草稿转成公开后积压上来（真 PUBLISHED 的条数明显超过池里已登记的），再按本卡的正确判据重做；否则保持不做。代码留在已关闭的 PR 2812 分支 feat/ads-creative-pool-intake
---
撤的理由：按正确判据这刀每三周才登记约 1 条，而人手填的 3 条本来就填对了——人做对了这刀要做错的那道判断。按「谁发起/有几条/人真每周撞上吗」三条不过，只开卡。
正确判据（别再用 status='published'，草稿也会是它）：status in (published,measuring,closed) 且 published_ref->>platform='facebook' 且 video_state='PUBLISHED'，现成写法在 publish/publish-worker.ts:458-460；id 形状校验抄 reel-published-event.ts:38。
另四处必改（子牙/魏征）：parseCreativePool 过滤后整池回写是有损改写；读-改-写会覆盖 PM 刚点的批准；upsert 别碰 updated_at（它是自治同步的幂等键）；cron 回执没进 cron_run_logs 等于没法验。
