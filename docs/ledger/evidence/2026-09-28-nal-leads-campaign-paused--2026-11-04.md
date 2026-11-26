# 证据 · 2026-09-28-nal-leads-campaign-paused · 2026-11-04
fetched_at: 2026-11-04T21:37:30+1300
查了什么：按 verify_how 三件。①Meta 只读接口查「新亚8月广告系列-物流」真实投放状态；②生产库 ad_daily_insights（系列级）结算 9/01–9/30 全账户开聊次数对月目标 300（PM 9-25 给）；③「物流广告组-WhatsApp」每次开聊成本：暂停前基线 9/21–9/27 对暂停后 9/29–9/30，9/28 两边都不算。
数字（带样本量、两边取数状态）：①被停系列 effective_status=PAUSED，最后一次改动时间 2026-09-28 02:49 NZ，之后没人重开；WhatsApp 系列 ACTIVE。②9 月全账户开聊 291 次（被停系列 107 + WhatsApp 183 + 另一系列 1），对月目标 300 差 9 次（约 3%）。③WhatsApp 系列暂停前 7 天 89 次开聊、暂停后 2 天 29 次开聊（≥ 卡上 10 次的样本门槛），暂停后每次开聊成本比基线低约 10%，没有涨。Meta 接口与生产库两边取数都正常。
来源/命令：Meta ads_get_ad_entities(level=campaign, fields=status,effective_status,updated_time)；Supabase 只读 SQL 对 ad_daily_insights 按 entity_id、insight_date 窗口 sum(messaging_conversations)、sum(spend)。
结论：成。停投没被撤回，WhatsApp 独自承担后开聊成本没变贵，9 月开聊离目标只差 3%，不属于「差得多」；verify_how 末尾那个「要不要补预算」的决定本来就归 PM，现已过去五周、NAL 后续广告已另起卡，这里不再单独催。
