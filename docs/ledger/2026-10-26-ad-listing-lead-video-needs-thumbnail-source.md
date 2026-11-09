---
id: 2026-10-26-ad-listing-lead-video-needs-thumbnail-source
title: 房源「留资+视频」建广告入口会被新的封面校验拒绝，需给它补封面来源（例如转码后读 Meta 视频自带封面）
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3177
verify_by: 2026-11-02
verify_how: 受影响入口：listing-draft-builder.ts（creative 带 videoId）与 draft-listing/route.ts 的视频上传分支；asset-upload.ts 的 uploadVideoToMeta 不返回封面。3177 合并后该入口建「留资+视频」会被 validateDraft 拒（缺封面）——目前 CTS 不走这个入口。补法：BuildOptions 增加封面来源（转码后读 Meta 视频的 picture，或上传一张封面拿 image hash）。到期前确认已补，或确认没有客户走该入口。
---
3177 的有意后果：留资视频必须有封面（Meta 的 video_data 要求）。老入口不给封面，会明确报错而不是建出坏广告。
