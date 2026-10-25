---
id: 2026-10-25-risk-gate-diff-and-auth
title: 合并闸：大文件按改动行判断，鉴权改动定为 A
status: done
owner: agent
decided_on: 2026-10-25
source: pr:3133
verify_by: 2026-11-01
verify_how: 本闸合进主干后，抽一个只改大文件里一行、不碰库表/凭证/广告花费的 PR，不应再被标 needs-ray-merge；抽一个在接口里新增或删掉登录/客户访问校验的 PR，应判 A。本来就碰库表、Meta 凭证或广告花费的，仍然留给 Ray。
done_on: 2026-10-25
done_ref: pr:3148
---
Ray 2026-10-25 同意修合并闸。误报见 pr:3133：整文件超过读取上限就被当成可能改广告花费。
漏报见 pr:3123：接口里加了登录和客户访问校验，闸只看路径，没认出鉴权，判成 B。
整文件读不到时改看这次 diff 的增删行；diff 也没有才留给 Ray，并写明原因。
审查补上两处：超过 Contents 上限的文件改用 Git blob 读整篇（最大 100MB），读到就按整篇判断，原来就导入了广告写入模块的仍然留给 Ray；只有整篇也读不到才看 diff。接口报错（限流、5xx、网络错误）仍然留给 Ray，不改看 diff。源文件的 diff 被省略时，鉴权判定按 A。
不改数据库，不碰 Meta 凭证，不改广告花费。
