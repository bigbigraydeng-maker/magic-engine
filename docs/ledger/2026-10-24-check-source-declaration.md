---
id: 2026-10-24-check-source-declaration
title: 检查环节只说明进度数的是笔数、座位还是别的，缺数不记 0
status: decided
owner: agent
decided_on: 2026-10-24
source: pr:3079
verify_by: 2026-10-31
verify_how: 在仓库根目录跑 npx vitest run src/lib/strategy/__tests__/check-source.test.ts，退出码为 0；证据里没有进度数字。接到检查页或每日刷新是下一张，不在这张里。
---
给定一条目标和它的配置，只说明这次进度读哪张表、数的是笔数、座位还是其他。
缺字段或没有行时记未知，不出数字，也不写 0。
座位必须由这条目标的配置打开，行业和出发日名单不会改口径。
本张不写目标当前值，不改现有取数。检查页和每日刷新的接线留到下一张。
