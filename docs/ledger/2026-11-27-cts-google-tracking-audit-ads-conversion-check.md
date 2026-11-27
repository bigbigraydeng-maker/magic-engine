---
id: 2026-11-27-cts-google-tracking-audit-ads-conversion-check
title: CTS 谷歌追踪只读体检完成，12-04 核广告账户有没有记到官网询盘
status: done
owner: agent
decided_on: 2026-11-27
done_on: 2026-11-27
done_ref: doc:docs/ledger/2026-11-27-cts-google-tracking-audit-ads-conversion-check.md
source: session:ca3e0d15
verify_by: 2026-12-04
verify_how: 进 Google Ads 看主转化（来自 GA4 询盘事件）11-27 之后有没有记录，同时看 GA4 同期来源为谷歌付费点击的询盘数。广告账户记到了算成；GA4 有付费来源询盘而广告账户 48 小时后仍为零算不成，查账户关联和归因后报 PM；GA4 也没有付费来源询盘记为判不了，另开新卡顺延一周
---
体检结果：官网实际靠代码直接装 GA4 和广告标签，Tag Manager 容器没有装上（不要直接补装，已发布版本会让询盘记两遍）。
待 PM 决定的改动：GA4 里按感谢页浏览生成的第二个关键事件造成询盘重复计数；事件数据只留 2 个月；内部流量过滤停在测试状态；币种为澳元；GA4 未连 Search Console。
收录侧：几篇在线文章仍链到打不开的旧团页和指南页，两个旧站点地图条目读取失败；无人工处罚和安全问题。海外三地访问停留极短，疑似机器访问（未证实）。
本次全程只读，没有改任何设置。
