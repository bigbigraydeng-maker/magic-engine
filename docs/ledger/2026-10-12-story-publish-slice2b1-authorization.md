---
id: 2026-10-12-story-publish-slice2b1-authorization
title: Story 发布第二刀 b-1（授权 / 撤销 / 预览接口 + 存储层）：只演练，建表与真发都没批
status: decided
owner: pm
decided_on: 2026-10-12
source: session:61a3b5f4
verify_by: 2026-10-19
verify_how: 看 b-1 的 PR 是否合并；看 b-2（发布器 + 熔断 + 值班表 + 价格实测）与 b-3（预览页面）是否已另开；建表、真实上传、真实 Meta 调用、真发开关每一项 PM 没另批就保持未做
---
b-1：授权判断的服务层（预览、记录打开、授权、撤销）+ 真实存储层 + 4 个仅限全局管理员的接口，默认演练；授权不发布任何东西。
价格实测未接（含价格的条目现在一律授权不了，故意失败即停）；Instagram 账号编号表里没有，Instagram 条目授权不了，等 10-16 登记。
本机临时数据库端到端演练已跑通（不碰线上库）；建表 SQL 仍未在线上执行。
