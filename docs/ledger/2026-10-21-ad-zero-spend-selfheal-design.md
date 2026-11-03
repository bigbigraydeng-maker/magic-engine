---
id: 2026-10-21-ad-zero-spend-selfheal-design
title: 新建/重建广告组 2–3 小时仍零消耗不干等：自检 + 一次性克隆重建 + 根因统计（设计要点，未写代码）
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:3017
verify_by: 2026-10-28
verify_how: 子牙+魏征审过设计后才进实现；实现后试跑（dry_run）：造一个零消耗广告组，应在 2 小时出自检待办，3 小时出一键重建请求；CTS（observe）下不得自动重建。
---
A 级设计稿，PM 2026-10-21 要求；只设计，不含代码；不构成对自动花钱的授权。
