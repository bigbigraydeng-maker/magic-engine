---
id: 2026-10-21-website-jsonld-logo-url-404
title: 官网约 30 个指南页的结构化数据里写的 logo 地址线上是 404（首页用的 /logo.png 正常），谷歌读不到站点 logo
status: decided
owner: agent
decided_on: 2026-10-21
source: session:ec90bb17
verify_by: 2026-11-04
verify_how: 官网各指南页源码里结构化数据的 logo 地址请求返回 200（统一改成真实存在的图片地址，最好只在一处定义）；抽 3 个指南页用谷歌的富媒体结果测试，logo 项没有报错；官网仓库有一条检查，结构化数据里引用的本站图片地址在 public 目录里必须存在。
---
2026-10-21 121 号做官网图片体检时发现：各指南页的结构化数据（谷歌读的站点信息）里 logo 地址写成 /images/cts-logo.png，线上这个地址是 404，涉及约 30 个文件；首页用的 /logo.png 正常。已转给 95 号（SEO）。
按 §11：频率 低（只影响谷歌读站点 logo）/ IMPACT 低 / 收入 低 → P3，记入待认领，不抢资源；顺手修便宜（一处常量），所以留 11-04 验收。
