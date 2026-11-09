---
id: 2026-10-27-refine-route-missing-schedule-import
title: 精修处方的接口在 3227 合并后缺了一行导入，点精修会报错；已补上
status: done
owner: agent
decided_on: 2026-10-27
source: pr:3269
verify_by: 2026-10-30
verify_how: 在 ME 后台任意一份处方点一次「精修」，应立刻回「已受理」并转入生成中，而不是报错；看 Render 日志里没有「schedulePrescriptionRefine is not defined」。若点的是客户真处方，注意精修会重写内容，先用测试客户或已批准处方之外的草稿；点不了就看 PR 里的测试结果。
done_on: 2026-10-27
done_ref: pr:3269
---
根因：3227（开方先回话）合并时，另一条分支同时改了精修接口的权限导入，合并冲突解决后丢了 schedulePrescriptionRefine 那一行导入，调用处运行时会 ReferenceError。主干上这个接口自己的 3 条测试当时就是红的，但主检查不跑全量测试，所以没拦住。
修法：补回导入，并去掉已不用的 refineHuatuoPrescription 导入。类型检查里这一条错误消失；处方接口目录 7 个文件 56 条测试全过，改回旧版 3 条测试变红。
