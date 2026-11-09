---
id: 2026-09-26-fb-auth-error-code-200
title: Facebook 同步失败待办把 code 200 / 10 也算成「要人重新授权」——原来只认 190，两个客户拿到了错的指引
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 合并部署后看今日待办邮件：Roman HU 和 East International 这两条的 how 应该写「请主页管理员点连接 Meta」，不再是「回我一句我去查」。四个客户（Magic Lab Class / NAL / Roman HU / East International）都该出现，且都指向客户自助重连那条路
---
当场试跑抓到的：拿生产库 2026-09-26 真实运行记录跑检测器，4 个在失败的客户里有 2 个报的是 code 200（缺权限 / 令牌对应的人在该主页没有被批准的角色），被判成「不是授权问题」，卡片写成「这条不用你动手，回我一句我去查」——但我查完也只能得出「请主页管理员重新授权」这同一个结论，等于白跑一次往返。
设计复审当时判「code 200 不算盲区」，前提是没有客户在撞它；真实数据把前提推翻了。
改法：判据认 190 / 200 / 10 三个码 + OAuthException + `(#200)` 写法。试跑复核：改前 2 条走错路径，改后 4 条全部指向客户自助重连。
顺带查实（不在本卡范围）：4 个客户的 Facebook 同步都在失败，不只 NAL。
