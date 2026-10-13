---
id: 2026-10-06-montage-guard-patch
title: 蒙太奇模板补了 5 个缺口（地名必绑镜头、闪白只留每 4 拍、列出配方没满足的项），配方库显示快切是纯假设
status: done
owner: agent
decided_on: 2026-10-06
source: session:549c3765
verify_by: 2026-10-13
verify_how: 合并后用真实广告跑 CTS 蒙太奇，看看满 15 秒的比例（至少几百次展示再判）；配方库里没有一条像 0.4–0.6 秒一镜，不达预期就回到 2 秒左右一镜的清单版。
done_on: 2026-10-06
done_ref: doc:docs/audits/2026-10-06-montage-guard-patch.md
last_checked: 2026-10-13
---
补丁包只动 `scripts/factory-worker/` 与文档，旧的 montage 工单缺新必填项 `placeTerms` 会被拒（目前没有在途工单）。当场试跑与配方库复核数字见审计文档。
