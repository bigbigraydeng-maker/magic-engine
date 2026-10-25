---
id: 2026-10-25-risk-gate-diff-and-auth
title: 合并闸：大文件按改动行判断，鉴权改动定为 A
status: decided
owner: agent
decided_on: 2026-10-25
source: pr:3133
verify_by: 2026-11-01
verify_how: 本闸合进主干后，抽一个只改大文件里一行、不碰库表/凭证/广告花费的 PR，不应再被标 needs-ray-merge；抽一个在接口里新增或删掉登录/客户访问校验的 PR，应判 A。本来就碰库表、Meta 凭证或广告花费的，仍然留给 Ray。
---
Ray 2026-10-25 同意修合并闸。误报见 pr:3133：整文件超过读取上限就被当成可能改广告花费。
漏报见 pr:3123：接口里加了登录和客户访问校验，闸只看路径，没认出鉴权，判成 B。
整文件读不到时改看这次 diff 的增删行；diff 也没有才留给 Ray，并写明原因。
不改数据库，不碰 Meta 凭证，不改广告花费。
