---
id: 2026-11-27-cts-google-tracking-fixes
title: CTS 谷歌追踪问题经 PM 同意修复，后台已改、官网改动等合并，12-04 核
status: done
owner: agent
decided_on: 2026-11-27
done_on: 2026-11-27
done_ref: doc:docs/ledger/2026-11-27-cts-google-tracking-fixes.md
source: session:ca3e0d15
verify_by: 2026-12-04
verify_how: 进 GA4 核关键事件只剩询盘事件一个（另一个无数据的购买事件不计）、事件数据保留 14 个月、币种纽币、Search Console 关联在；进 Search Console 核站点地图只剩一条且读取成功；看官网仓库改动单 321 是否已合并上线，已上线则核旧云南网址跳到可打开的云南团页、两篇文章的结构化数据能解析、GA4 出现过点电话事件。全对算成；官网改动单仍未合并或任一项不对算不成，报 PM
---
授权回执：PM 本人 11-27 在本对话回「全修」。后台改动：取消感谢页浏览事件的关键事件标记、保留期、币种、连 Search Console、删两个读取失败的站点地图条目；撤回办法：各设置页改回。
官网改动单 https://github.com/bigbigraydeng-maker/chinatravel/pull/321 尚未合并，合并即上线官网，需 PM 另外点头。
没改：内部流量过滤（账户里没有任何规则，需要公司网络地址）；疑似机器访问；产品页沿用公司整体评分作单品评分（可能不合谷歌规则）。
