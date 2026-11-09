# 证据 · 2026-09-27-cts-thruplay-audience-supply · 2026-11-01
fetched_at: 2026-11-01T21:34:53+1300
查了什么：卡上三项——版位是否干净、两个再营销视频池是否涨、真实每次完播成本。
数字（带样本量、两边取数状态）：
- ① 版位：Meta 只读接口（ads_get_ad_entities，个人账户，level=adset，筛名称含 ThruPlay，breakdowns=publisher_platform，时间 2026-09-27~2026-10-31）。唯一命中组「ThruPlay - NZ - Reels」(optimization_goal=THRUPLAY，现 CAMPAIGN_PAUSED)：facebook 花 NZ$192.09 / 完播 9559；instagram 花 NZ$1.10 / 完播 62；audience_network 无任何行（=0）。取数成功。
- ② 池子：生产库 ad_entity_snapshots 最新快照（captured_at 2026-10-31 12:30 UTC）：「CTS - Video viewers 50% - 365d」下限 44100（9/26 基线 37800）；「CTS - ThruPlay viewers - 365d」下限 28300（9/26 基线 22200）。两池都涨。取数成功。
- ③ 每次完播成本：(192.09+1.10)/(9559+62) ≈ NZ$0.020，样本 9621 次完播，全部来自 facebook/instagram，无 audience_network 污染流量。
来源/命令：Meta MCP ads_get_ad_entities（只读）；Supabase execute_sql（只读，select distinct on entity_id … from ad_entity_snapshots where level='audience'）。
结论：成——三项都达标：Audience Network 花费为 0，两个池子都比 9/26 涨，完播成本 NZ$0.02 且来源干净。（注：该组所在系列现已暂停。）
