---
id: 2026-10-06-remotion-pack-c-registry-and-worker
title: Remotion 包 C：出片机渲蒙太奇并从共享乐库取音乐，真领生产测试单已走通（进审片队列），草稿待审
status: done
owner: pm
decided_on: 2026-10-06
source: doc:docs/specs/2026-10-06-remotion-template-catalog-and-selector.md
verify_by: 2026-10-13
verify_how: 子牙+魏征+狄仁杰审过、PM 回「合」后合并；合并后把常驻出片机升级到含包 C 的版本，并在其 .env 配 FACTORY_REMOTION_CLIENT_IDS 后，再领一张 montage 单确认常驻出片机也能出片（本次试跑是第二个出片机进程领的）；测试单 23ba32e8 还在审片队列，PM 决定批准、拒绝还是归档。
done_on: 2026-10-06
done_ref: doc:docs/audits/2026-10-06-remotion-pack-c-registry-and-worker.md
---
包 C 是 A 级草稿（碰出片机准入）。PM 2026-10-06 授权后建了一张生产测试单 23ba32e8（只存草稿不发布），本分支代码的出片机领单、渲染、提交走通，服务端 7 项自动检查全 PASS，进了审片队列。选择器（包 D1）依赖本包与官网产品事实 PR 2270。
**合并顺序（必须按这个来）**：①子牙+魏征+狄仁杰审过、PM 回「合」，合并包 C；②**把本机常驻出片机用的那份代码（`/Users/raydeng/Projects/magic-engine-worker`，现在是 main 的旧版，只对 CTS 开 Remotion）更新到含包 C 的版本，并重启常驻出片机**，同时在它的 `.env` 里配好 `FACTORY_REMOTION_CLIENT_IDS`；③之后才能建 `montage` 工单。旧版出片机一旦领到 `montage` 单，会按「不可重试」判失败、单子作废。新版里「模板不认识」（`UNKNOWN_TEMPLATE:`）和「音乐目录读不了」都改成了可重试（本质是版本/环境不一致，别的出片机可能能做）。
