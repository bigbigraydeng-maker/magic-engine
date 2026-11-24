# 证据 · 2026-10-09-cts-thruplay-placement-leak-already-fixed · 2026-11-25
fetched_at: 2026-11-25T03:22:03+13:00
查了什么：Meta read CTS account spend by publisher platform and ad set, time range 2026-10-09 to 2026-10-23 and last 14 days
数字（带样本量、两边取数状态）：Window 10-09..10-23: the ThruPlay ad set spent on facebook 29.61 and instagram 0.09 only, no audience_network row. Last 14 days: no ThruPlay ad set had spend; the only audience_network spend (4.23 total) sat in two lead-form ad sets, not the awareness pool.
来源/命令：见「查了什么」，均为只读查询
结论：成，养池广告组只在 Facebook 和 Instagram 花钱，第三方应用版位是 0。
