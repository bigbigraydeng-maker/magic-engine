---
id: 2026-10-19-tour-delist-footprint-gate
title: 团下架/推广要有机器闸：官网加「已下架团残留扫描」+ 登记表 + 引用位置清单脚本
status: decided
owner: agent
decided_on: 2026-10-19
source: session:ec90bb17
verify_by: 2026-10-23
verify_how: 官网仓库有下架登记表和残留扫描测试；故意在某页面留一处旧团名，测试要变红、拿掉变绿（红绿输出为证）；合并部署后对生产跑 verify-delisted 脚本全绿；推广或下架前用 tour-footprint 脚本列出该团所有引用位置
---
起因：10-19 下架 Christmas 团时发现官网有十几处写死入口，只把团设为停用不会消失，推广时也一样会散落多处。
做法：官网窗口 121 在 Christmas 下架 PR 里同时交付这套机器闸；ME 侧已排查广告、排期、邮件和真实订单（结果另报）。
长期：官网改为只读团目录（唯一来源）见 docs/specs/2026-10-14-tour-catalog-website-alignment-onepager.md。
