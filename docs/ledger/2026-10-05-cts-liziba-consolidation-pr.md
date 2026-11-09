---
id: 2026-10-05-cts-liziba-consolidation-pr
title: CTS 李子坝三页合并的网站改动已做成草稿 PR（chinatravel#221），等 10/11 体检之后合并
status: decided
owner: pm
decided_on: 2026-10-05
source: session:cdd5dbf9
verify_by: 2026-10-12
verify_how: PM 在 10/11 周日网站体检之后说"合并网站"；合并前查一次 /liziba-station-chongqing 的外链；合并部署后线上打开旧地址应 308 到 /blog/liziba-station-chongqing-guide，两页标题为 57 / 54 字符；之后 28 天这三页不再改，用谷歌逐页数据对比三页合计点击、曝光、平均排名（基线是改动前 28 天）
---
PM 2026-10-05 回复"全做"。草稿 PR https://github.com/bigbigraydeng-maker/chinatravel/pull/221：旧页 B 永久跳转到主页面 A、6 处内链改到 A、A 的标题改 57 字符、C 的标题 92→54 字符并回链 A、站点地图去旧页。本机试跑（staging 模式，无广告像素）：308 跳转、标题、内链、站点地图均核对通过；tsc 无错，jest 564 条全过。
未处理：/chongqing-travel-guide 的"相关指南"卡片仍链到旧页（组件只认指南），靠跳转转发。衡量不做点击归因：只看三页合计点击/曝光/平均排名与全站同期趋势。
