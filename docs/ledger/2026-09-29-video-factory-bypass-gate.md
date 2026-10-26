---
id: 2026-09-29-video-factory-bypass-gate
title: 视频工厂唯一出口规矩落地技术闸——静态 CI 检查拦「另写脚本绕过」
status: done
owner: agent
decided_on: 2026-09-29
source: session:fe293c6f
verify_by: 2026-10-13
verify_how: 到 `docs/ledger/2026-09-29-video-factory-only-rule.md` 的 `verify_by`（2026-10-13）时一并核：本闸门是否已被 PM 加入主干必过检查清单（不加入则 B/C 级 PR 仍可能带红继续自动合），以及这两周内有没有新的「同一文件里既调视频生成接口又调发布接口、且不在 `src/lib/factory/` 下」的 PR 出现过（不论被拦住还是漏网）。
done_on: 2026-09-29
done_ref: pr:2177
---
静态 CI 检查（`.github/workflows/video-factory-bypass-guard.yml` + `tools/ops-review-loop/src/{check-,}video-factory-bypass.mjs`）：任何 PR 新增代码，只要在 `src/lib/factory/` 之外的同一个文件里同时出现视频生成接口（Muapi / Atlas Cloud=WaveSpeed/Seedance）和视频发布接口（Facebook Reel / Instagram），判定为绕过视频工厂，检查判红。24 条单测覆盖 East Inter 事故重建形状（含跨路径变体、大小写）与四类不该拦的正常改动（工厂内部改动、自身控制面、测试文件、纯文档引用），另跑真实 PR（#2175 文档 PR、#1913/#1475/#1307 三个真实工厂相关 PR）验证零误报。
已知边界，未解决：①这道闸只能看见**提交进仓库**的代码，拦不住「本地跑一次从不提交」——East Inter 那次事故本身就是这种，闸门堵不住这个洞，见闸门源码顶部说明；②本闸门今天**没有**被加进 GitHub 仓库设置的必过检查清单，加不加、什么时候加需要 PM 在合并这张卡对应的 PR 时一并授权（`.github/merge-authorization.md` 里写的"仓库设置，PM 合并接线 PR 时一并授权"那条）——不加的话，B/C 级 PR 即使这里判红仍可能被自动合掉；③曾考虑过在 Kernel 里给"发布视频"加一个像广告动作那样的 ActionKey 授权信封（运行时闸），评估后放弃：本仓库里发布视频没有唯一的底层函数（工厂适配器、`ad-publisher.ts`、`facebook-publisher.ts` 各自手写 `fetch`），而且东北事故的脚本本来就没导入过仓库里任何函数，堵哪个函数都堵不住这次这种绕法，做这层还要动 `src/lib/factory/` 内部，不在本次任务授权范围内；④（子牙审出，已修一半）文件名故意起成 `*.test.mjs` 这种测试文件形状，能让检查把它当测试跳过——已改成"降级为提醒、不拦但留痕"，不再完全静默放行，但仍然不拦，需要人自己看提醒；⑤（子牙审出，未修）新文件直接放进 `src/lib/factory/` 目录、但压根没被 `daily-plan`/`post-review`/`publish-queue` 任何一处真正调用，闸门照样当成"在安全区内"放行——这是设计上的固有局限，只按目录信任、不验证真的接进了审核链路，做真正的引用关系分析工作量不小，这次没做。
