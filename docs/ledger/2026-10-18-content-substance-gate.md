---
id: 2026-10-18-content-substance-gate
title: 加「有没有实际内容」闸：成片屏幕上没有团名/地点/卖点/品牌卡的，机器直接拦、不进审片页；审片清单加「单独发给粉丝能看懂吗」
status: decided
owner: agent
decided_on: 2026-10-18
source: session:ec90bb17
verify_by: 2026-10-25
verify_how: 设计稿过子牙+魏征审并经 PM 看过后做代码（PR-1 A 级出片机侧、PR-2 B 级服务端+审片页）；验收＝拿氛围片样片 17419d99 的真实 props 重放必须被拦（日志含「内容闸」、无成片、不进审片页），标 asset_only 的版本放行但没有「通过」按钮且 approve 接口 409；list/postcard 的已通过工单 props 重放不被误伤。
---
背景：氛围片样片 17419d99 被 PM 批「没有实际内容」，但 7 项自动体检全 PASS（全是技术项，没有一项问「单独发给粉丝能看懂吗」）。PM 10-18 回「加闸」。设计稿：docs/specs/2026-10-18-content-substance-gate-design.md（只设计未写码；氛围片走「加内容」还是「降格为素材」交 PM 选）。
