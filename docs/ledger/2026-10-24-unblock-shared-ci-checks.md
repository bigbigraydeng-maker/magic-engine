---
id: 2026-10-24-unblock-shared-ci-checks
title: 清掉挡住检查的三件旧问题：台账格式、公开目录接口、类型检查内存
status: decided
owner: agent
decided_on: 2026-10-24
source: doc:docs/ledger/README.md
verify_by: 2026-10-25
verify_how: 本 PR 上 Ledger entries valid 与 Tour catalog boundary test 通过；Type-check 的 tsc 跑完，日志里没有新增的 error TS。
---
五张旧台账按已合并的 PR 补完成指针。公开网站目录接口列入边界白名单，响应不变。
类型检查只把内存上限从 4GB 调到 7GB。合进主干之前，其他 PR 仍会撞上这三件旧问题。
