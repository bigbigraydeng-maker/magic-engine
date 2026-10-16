---
id: 2026-10-14-cts-click-to-call-outbound
title: CTS 员工在 CRM 点一下外呼客人：先打员工手机再接客人，用 CTS 号码、自动录音，进同一条分析线；默认关，说过别再联系的人不拨
status: decided
owner: pm
decided_on: 2026-10-14
source: session:96dc6edf
verify_by: 2026-10-16
verify_how: 在 Render 开 TELEPHONY_OUTBOUND_ENABLED=1 后，PM 在测试客人页点「用 CTS 号码拨打」：先响 PM 自己登记的手机，接起后另一部测试手机响并先听到录音告知；通了之后 CRM 时间线出现「外呼，通话 N 秒」、分析卡片出现；再对一位标了别再联系的人确认按钮不出现、接口返回 409
check_note: 2026-10-15 PM 说外呼已测试完、范围仅新西兰、CTS 已同意（未核实）；「澳洲/中国拨打权限」「CTS 书面同意」两项作废；线上开关与录音告知话术待核
last_checked: 2026-10-15
---
走 Twilio 的外呼接口，回调复用既有接收口（验签覆盖的 cp 参数传客人号码）。开关默认关；员工手机来自连接的分机表，没登记不拨。
还没做：外呼录音告知文案 CTS 确认；打澳洲/中国要在 Twilio 另开拨打权限；真实客户外呼前需 CTS 书面同意。
