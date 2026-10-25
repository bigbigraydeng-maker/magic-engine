---
id: 2026-10-21-cts-whatsapp-calling-off-use-phone
title: CTS 的 WhatsApp 通话开关是关的且开不了（缺通话事件接收通道），语音先不开发，改让想打电话的客人拨电话号码
status: decided
owner: pm
decided_on: 2026-10-21
source: session:96dc6edf
verify_by: 2026-11-04
verify_how: 看 WhatsApp 公司资料里是否已写上 CTS 的电话号码（由 PM 在 Meta 后台填，或 CTS 确认后由系统填）；同时问 CTS 销售这两周有没有客人说想在 WhatsApp 里打电话；有真实需求才另开 A 级方案卡
---
2026-10-21 PM 在 Meta 后台试开 CTS 号码（新西兰那个）的通话开关，被拒：要先配置通话事件的接收（webhook 或 SIP），ME 目前没有这套，开关没变，仍是关。所以客人现在在 WhatsApp 里没有拨号入口，不是活的问题。
决定：不开发 WhatsApp 通话接听（要搭接电话的声音通道，A 级大块）。先把电话号码放进 WhatsApp 公司资料，想打电话的客人直接拨电话；电话本身走已有的点击拨号和新西兰号码方案。有真实需求再开方案卡。
