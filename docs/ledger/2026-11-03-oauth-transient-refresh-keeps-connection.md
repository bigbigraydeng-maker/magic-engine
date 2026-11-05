---
id: 2026-11-03-oauth-transient-refresh-keeps-connection
title: 刷新授权碰上谷歌 / 微软临时故障（5xx、限流、网络断）不再把连接永久标坏；CTS、NAL 的 GA4 就是这样被停了几天
status: verified
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-05
verify_how: CTS、NAL 两条 GA4 连接改回 active 后，看 11-04 和 11-05 两天的 google-data-pullback-daily 运行记录：summary.errors 里没有 ga4、ga4_synced 比 11-02 的 4 多（回到 6）；这两天如有临时刷新失败，platform_oauth_connections 里对应连接仍是 active
done_on: 2026-11-03
done_ref: pr:3560
last_checked: 2026-11-05
verified_ref: evidence/2026-11-03-oauth-transient-refresh-keeps-connection--20261105.md
check_note: PR3560 已合并；CTS GA4 连接 active(11-04更新)；cron google-data-pullback-daily 11-03/11-04 均 completed ga4_synced=7 errors=[]
---
11-01、11-02 谷歌数据回拉报 failed 的根因：CTS 的 GA4 10-31 刷新时谷歌回一次 HTTP 500，NAL 的 GA4 11-02 碰上一次 fetch failed，两条都被永久标成 error，之后每天跳过。只读探针证实两条刷新令牌现在都能换到访问令牌。
修法只改 src/lib/platform-oauth/token-manager.ts 的判断（临时失败只抛不标）。两条连接改回 active 是改正式数据，单独问 PM。
