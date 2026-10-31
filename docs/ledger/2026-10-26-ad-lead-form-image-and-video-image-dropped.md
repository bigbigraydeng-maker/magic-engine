---
id: 2026-10-26-ad-lead-form-image-and-video-image-dropped
title: 留资广告同时给了图片和视频时，图片会被静默丢掉（只用视频）——要加提示或拒绝
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3177
verify_by: 2026-11-02
verify_how: ad-publisher.ts 的 lead_form 分支：有 videoId 就写 video_data，imageHash 不再使用。需在 validateDraft 里对「同时给图和视频」给提示或拒绝（先查有没有调用方会同时给，例如 draft-listing 的 opts.imageHash/videoId 都可能被填）。到期前确认处理方式。
---
3177 没有改成拒绝，是怕误伤现有入口；记在这里等核对调用方后再定。
