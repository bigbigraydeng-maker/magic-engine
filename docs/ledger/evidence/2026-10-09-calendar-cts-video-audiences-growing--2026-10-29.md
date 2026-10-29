# 证据 · 2026-10-09-calendar-cts-video-audiences-growing · 2026-10-29
fetched_at: 2026-10-29T21:36:35+1300
查了什么：生产库 ad_entity_snapshots（level=audience，CTS）两个池按新西兰日期取最大 audience_count_lower；ads_growth_states 10/09~10/10 有没有 D11。
数字（带样本量、两边取数状态）：ThruPlay viewers 365d：10/08 27100、10/09 27400、10/10 27900、10/11 28100（今晚 10/29 为 28100）。Video viewers 50% 365d：10/08 43500、10/09 43600、10/10 44100、10/11 44400（10/29 为 44300）。10/10 两池均 ≥ 判据基准 27400 / 43600。ads_growth_states CTS 10/09、10/10、10/11、10/12 各 1 行，含 D11 的 0 行；同一查询能查到 10/21、10/22 有 D11（说明匹配有效，那是窗口外的新情况）。每日快照均取到，无报错。
来源/命令：Supabase CrazyContent 只读 SQL（ad_entity_snapshots / ads_growth_states）
结论：成。10/10 两池未下降、10/09~10/10 无 D11。附注：D11 在 10/21、10/22 又出现过，不属本卡窗口。
