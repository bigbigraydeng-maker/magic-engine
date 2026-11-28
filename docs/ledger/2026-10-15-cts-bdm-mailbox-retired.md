---
id: 2026-10-15-cts-bdm-mailbox-retired
title: CTS 的 bdm@ 邮箱 PM 决定不再使用，已按退役处理
status: done
owner: pm
decided_on: 2026-10-15
verify_by: 2026-10-17
verify_how: "查 platform_oauth_connections 里 bdm@ctstours.co.nz 一行 status 仍为 revoked；info@ 与 NAL 的 sales@ 仍为 active；10/16、10/17 两天的每日待办里不再出现 bdm@ 这条断线提醒，也没有误报 info@"
source: session:90a50c3b
---
事实：该邮箱授权 2026-09-15 被吊销（invalid_grant / AADSTS65001），此后一条信都没进来；核查期间没有任何客人信息因它丢失的记录。PM 10-15 回「不要」。
做法：按退役处理，状态改 revoked，不删行、不动历史数据；断线体检对 revoked 的连接本就不纳入范围，所以每日待办不再提醒它。
未做：没有在 Microsoft 那边撤销任何东西，也没有碰 info@ 与 NAL 的 sales@（复核时两条仍 active，当天都正常同步）。
后续：若 CTS 以后要启用这个邮箱，走设置页重新连一次即可，不需要改数据。
