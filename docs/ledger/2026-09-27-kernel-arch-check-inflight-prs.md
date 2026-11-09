---
id: 2026-09-27-kernel-arch-check-inflight-prs
title: 内核架构检查设成必过后，4 个在飞 PR 下次推送会被拦，需要各自窗口改（2019 广告接线、1730 广告内核注册、1374 补迁移、1430 站点缓存）
status: decided
owner: agent
decided_on: 2026-09-27
source: session:d1add426
verify_by: 2026-10-04
verify_how: 这 4 个 PR 每个要么已关闭，要么最新一次提交上 gh pr checks <号> --required 里 Kernel architecture test 是绿的；任何一个还开着、这道检查红或没跑 = 不成（交对应窗口）
---
- #2019 草稿·WP3 广告接线｜what：新纳入了 meta 写模块，存量调用方只补登 1 个、.eslintrc.json 没同步，检查必红｜how：按失败提示「三处同加」补登调用方（boundaries.ts / .eslintrc.json / 测试冻结清单），同步模块冻结清单，先问子牙｜href：https://github.com/bigbigraydeng-maker/magic-engine/pull/2019
- #1730 广告内核注册（9/15 起没动）｜what：在同一个豁免数组尾部追加，合入主干会文本冲突｜how：先把主干合进来解冲突，再照上一条补登｜href：https://github.com/bigbigraydeng-maker/magic-engine/pull/1730
- #1374 补回生产 migration、#1430 站点缓存｜what：各有一个 migration 版本号跟主干已有文件相撞，检查必红｜how：把自己的文件改成更晚且唯一的版本号，别往撞号豁免清单里加｜href：https://github.com/bigbigraydeng-maker/magic-engine/pull/1374 · https://github.com/bigbigraydeng-maker/magic-engine/pull/1430
- 另有 14 个开着自动合并的 PR 还没跑过这道检查，但 9/27 查时它们都已经被别的检查挡着，下次推送会自动补跑，不用单独处理。
