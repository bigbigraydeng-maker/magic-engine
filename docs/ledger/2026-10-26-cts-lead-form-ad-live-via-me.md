---
id: 2026-10-26-cts-lead-form-ad-live-via-me
title: CTS 留资表单广告第一次整条走 ME 开投（处方→计划→起草→审批→投放）
status: done
owner: agent
decided_on: 2026-10-26
source: session:90a50c3b
verify_how: 本卡只记录「这条链路第一次整条跑通了」这件事，开投后的结果验证挂在两张姊妹卡上（2026-10-26-cts-formal-lead-ad-live-check / 2026-10-26-cts-formal-lead-ad-renew-1125），所以这里不另排验证日。要回头核「跑通过」这件事本身：在 flywheel_actions 查账本行 881d74c5 的 status=active、activation=executed，并在 marketing_plans 查计划 7a8bee93 status=approved、prescriptions 查 89cb61eb status=approved——三处同时成立即为真，任一不成立说明记错了。
done_on: 2026-10-26
done_ref: pr:3182
---
PM 2026-10-26 在 ME 后台亲手走完四步：批处方 89cb61eb（07:25）→ 批素材（兵马俑视频，07:33:18）→ 批计划 7a8bee93（07:33:54）→ 在广告审批页点「开始投放」（07:40 UTC / 20:40 NZ）。ME 自己的起草-审批-投放链路第一次在生产上跑完，之前 CTS 广告全是在 Meta 后台手工建的。
投的是：旧账户 7274，$50/天、30 天到 11/25、NZ 45-65 岁新客、兵马俑视频 + 封面、留资表单 v6.1、106 号文案（不写日期价格）。119 号直读 Meta：系列 / 广告组 / 广告三层均 ACTIVE 未被拒，日预算 5000、受众仅 NZ 45-65、advantage_audience=0。账本 flywheel_actions 881d74c5 status=active、activation=executed。
开投前 74 号写库补了三处（PM 回「同意写」）：兵马俑视频入素材池并声明推广期 10-26→11-30；清掉计划上海那步未批准的旧素材（上海 11/2 才开始，到时另补）；记一条落地页核实（WebFetch 核过 ctstours.co.nz/tours/china，三条 China Signature 团在售、与文案无冲突）。
处方要的「两组人群两条广告 + 47 人排除名单 + $100/天」只做了组 A 一半：起草器不会挂客户名单，组 B 老客户建不出来、排除名单挂不上。PM 10-26 回「开始」派 119 号做起草器挂受众那一刀；47 人名单官方账户上已有一份（10-20 传的），但旧账户不属于任何商务管理平台拿不到，PM 10-26 回「先不传」——等拿回主页权限、广告迁回官方账户再解决。
两个尾巴：这条用 Meta 自动版位（含 Audience Network），锁版位记在 2026-10-26-ad-lead-form-placements-follow-plan-step；11/25 到期要续，日历已排。
