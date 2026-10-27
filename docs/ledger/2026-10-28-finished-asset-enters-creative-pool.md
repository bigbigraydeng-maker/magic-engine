---
id: 2026-10-28-finished-asset-enters-creative-pool
title: 仅素材成片验收时上传到广告账户并待批准进素材池
status: done
owner: agent
decided_on: 2026-10-28
source: session:df1d1c5c
verify_by: 2026-10-31
verify_how: 用替身跑仅素材验收。开关不设时素材池多一条按工单引用、状态是待批准，视频编号来自替身上传回执。开关设为 0 时不上传、不进池、工单仍可归档。不调用 Meta，不改线上工单。
done_on: 2026-10-28
done_ref: pr:3317
---
仅素材工单在归档前，把成片传到该客户唯一主广告账户的视频库，编号回填后以待批准进入现有素材池。
不自动批准，不建广告草稿。上传默认开，环境变量设为 0 才停。
失败则工单保持待审，可以再点一次验收。
