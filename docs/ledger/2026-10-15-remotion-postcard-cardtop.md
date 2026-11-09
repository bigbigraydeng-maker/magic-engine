---
id: 2026-10-15-remotion-postcard-cardtop
title: 明信片版式补丁：文字卡可下移 + 只有片尾标题卡时最后一段可缩到 3 秒
status: decided
owner: agent
decided_on: 2026-10-15
source: pr:2674
verify_by: 2026-10-22
verify_how: PR 合并且出片机升级后，用 cardTop 与 4 秒片尾重出丝路 v2；自检图里确认卡片不再压住塔身、总长约 19 秒
---
苏东坡/马良复审丝路无价版 cd43bb66：嘉峪关卡片压塔身、片尾要压到 4 秒。
本补丁只在 postcard 模板内加可选参数；合并后升级出片机再重出。
