---
id: 2026-10-26-cts-lead-form-ad-live-via-me
title: CTS 留资表单广告第一次整条走 ME 开投（处方→计划→起草→审批→投放）
status: done
owner: agent
decided_on: 2026-10-26
source: session:90a50c3b
done_on: 2026-10-26
done_ref: pr:3182
---
PM 2026-10-26 在 ME 后台亲手走完四步：批处方 89cb61eb（07:25）→ 批素材 1133861909177335（07:33:18）→ 批计划 7a8bee93（07:33:54）→ 在广告审批页点「开始投放」（约 07:40 UTC / 20:40 NZ）。这是 ME 自己的起草-审批-投放链路第一次在生产上真正跑完，之前所有 CTS 广告都是在 Meta 后台手工建的。

投的是什么：旧账户 7274，$50/天、30 天到 11/25，NZ 45-65 岁新客，兵马俑视频 1133861909177335 + 封面 hash bb75f8d9…，留资表单 v6.1，文案走 106 号出的版本（不写日期与价格，符合 10-14「英文团、没有销售截止」口径）。账本 flywheel_actions 881d74c5-2ec9-42b7-a220-a09cbf0e5966。

开投前补的两件事（74 号写库，PM 回「同意写」）：把 1133861909177335 加进素材池并声明推广期 10-26→11-30；把计划里上海那步未批准的旧素材 1136316685721299 清掉（上海 11/2 才开始，到时另补）。落地页核实用 WebFetch 核过 ctstours.co.nz/tours/china，三条 China Signature 团在售、与文案无冲突。

本卡只记「这件事发生了」，不另带验证日：开投后的两次验证由 119 号的姊妹卡承担——2026-10-26-cts-formal-lead-ad-live-check（10-27 查通过审核没、花了多少、第一条线索进没进 CRM）与 2026-10-26-cts-formal-lead-ad-renew-1125（11-23 决定续不续），日历也挂在那两张卡的编号下，避免同一件事排两遍提醒。

读回证据（119 号 10-26 20:37 NZ 直读 Meta）：系列 120250459565520307 ACTIVE；组 120250459565950307 ACTIVE、日预算 5000、结束 11-25 20:34 NZ、受众仅 NZ 45-65、advantage_audience=0；广告 120250459567860307 ACTIVE 未被拒。账本 881d74c5 status=active、activation=executed。

两个已知尾巴：这条用 Meta 自动版位（含 Audience Network），锁版位按计划步骤 placements 的活记在 2026-10-26-ad-lead-form-placements-follow-plan-step；30 天 11/25 到期要续，已排日历。
