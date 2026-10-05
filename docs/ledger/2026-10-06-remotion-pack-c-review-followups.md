---
id: 2026-10-06-remotion-pack-c-review-followups
title: Remotion 包 C 审查留下的后续事项（选择器建单时校验模板、montage 补选段起点、素材来源不能信工单自报等），本包不做
status: decided
owner: agent
decided_on: 2026-10-06
source: session:0b72c898
verify_by: 2026-10-13
verify_how: 开选择器包 D1 前逐条核对：①D1 建单时用 isTemplateId 校验模板，或 claim 按出片机能力过滤，避免旧出片机把 montage 单永久作废；②montage 加 musicStartSec（等 PR 2283 合并后）；③素材来源（自有/库存/AI）由入库流程记录，不信工单自报的 clips[].source；④worker 里按模板名分叉的字幕/caption 下沉到各模板（加 quiz 之前）；⑤素材拷贝加大小上限。
---
子牙、魏征、狄仁杰对 PR 2289 各审一次的结论是「需改后可进」，能在本包修的已修（见 docs/audits/2026-10-06-remotion-pack-c-registry-and-worker.md 的审查表），这里只留本包范围外的几条。测试单 23ba32e8 仍在审片队列，需 PM 拒绝或归档。
