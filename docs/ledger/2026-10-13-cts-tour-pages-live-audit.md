---
id: 2026-10-13-cts-tour-pages-live-audit
title: CTS 官网 31 个团页线上体检表做完了（逐页缺口 + 站点级发现）
status: done
owner: pm
decided_on: 2026-10-13
source: session:317e4021
verify_how: 抽查体检表 31 页中任 3 页，线上实际页面与表内行程、评分标记、班期数字一致
done_on: 2026-10-13
done_ref: doc:docs/clients/cts/2026-10-13-cts-tour-pages-live-audit-v1.md
---
体检结论：「22 页没逐日行程」在线上 31 页内不是真缺（另 2 页未对齐），是抓取表认字漏了；真缺口是全站年龄字样、评分标记、编造评分、重复网址、班期落后。
待 PM 拍板、故意不建 decided 卡（避免被算成"决定了没动"）：四个草稿 PR（chinatravel #234–#237）等 CTS 确认班期价格后由 PM 点头合并；体检表第三节站点级问题等 PM 回「动」或「不动」。PM 决定后再各建一张卡。
