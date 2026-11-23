---
id: 2026-11-23-external-video-music-and-maliang-fallback
title: 外面做好的成片也能过素材三关：配乐按登记曲目查人声；Inngest 额度用完期间马良审片改由每 20 分钟的调度器补跑
status: decided
owner: agent
decided_on: 2026-11-23
source: session:ec90bb17
verify_by: 2026-11-24
verify_how: 上线后 cron_run_logs 里 maliang-direct-sweep 每 20 分钟一条；CTS 三条黑五成片工单 output 出现 maliang_check；点「收入素材库」后三关（马良/苏东坡/配乐）都显示过了
---
PM 11-23 回「修」、要求不绕过 ME。卡点两处：配乐关只认工厂模板的曲子，外部成片一律「读不到」；马良审片靠 Inngest，而 Inngest 本月额度 11-15 用完（PM 11-16 定不升），事件收下了但从没跑。
做法：工单写明用了曲库里哪首（external_music.track_id），配乐关照同一份人声登记表查；整曲核过的不限片长，有限时长的必须写片长否则判读不到。马良补跑沿用 11-16 的做法，挂进已有调度器，开关 INNGEST_DIRECT_FALLBACK=off，只捡还没结论的外部成片，每轮 1 条。
苏东坡关不改代码：外部成片把画面文字和官网原句登记进工单即可。按 §11：频率低 / IMPACT 高 / 收入高 → P1。
