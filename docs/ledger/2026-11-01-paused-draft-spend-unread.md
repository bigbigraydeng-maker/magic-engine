---
id: 2026-11-01-paused-draft-spend-unread
title: 暂停草稿确认卡读不到在投预算时保持灰灯
status: done
owner: agent
decided_on: 2026-11-01
source: pr:3437
verify_by: 2026-11-08
verify_how: 确认卡在没有近期快照、快照超过两天、账户编号对不上、或系列/广告组采集不完整时，日预算上限是灰灯并写「读不到在投预算」，确认按钮不能点。
done_on: 2026-11-01
done_ref: pr:3437
---
已在投日预算只在近期快照读全、且系列和广告组两层都有完整采集回执时才给数字。没有行不再当成零。原系列的重试和补暂停仍跳过原系列。
