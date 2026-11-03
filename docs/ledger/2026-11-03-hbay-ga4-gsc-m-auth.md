---
id: 2026-11-03-hbay-ga4-gsc-m-auth
title: HBay 在 ME 里授权 Google，把访问统计和搜索控制台接进 ME（PM 看过授权范围后回「点继续」，已接上）
status: done
owner: agent
decided_on: 2026-11-03
source: session:8044207b
verify_by: 2026-11-05
verify_how: 只读看 ME 里 HBay 的设置页和数据：①Google 搜索控制台那栏显示已连接、站点是 hbaywater.com 域名级；②GA4 那栏显示已连接、属性是 HBay Water；③GA4 数据快照的用户数大于 0（11-03 同步时是 0，因为 GA4 标准报表晚 24 到 48 小时，这条要到 11-05 才有意义）。①②③都对算成；③ 还是 0 先查网站源码里的 GA4 代码有没有被改掉，再查 GA4 实时报告有没有访问。已知旧坑：GA4 自动列属性会失败，所以以「有真数据」为准，不看「已连接」。
done_on: 2026-11-03
done_ref: doc:docs/clients/hbay-water/2026-11-03-hbaywater-website-and-todo.md
---
授权页要的权限含商家资料管理、表格读写、网址索引提交，Google 提示应用未验证；PM 看过后同意，已授权。
GA4 自动列属性失败，改手动填 Property ID，保存时 ME 现场验证成功；两个同步都成功但数字为 0（预期）。详见 done_ref 文档「数据测量」一节。
