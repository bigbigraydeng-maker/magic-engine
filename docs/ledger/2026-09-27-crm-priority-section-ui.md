---
id: 2026-09-27-crm-priority-section-ui
title: 「全部客人」页能按「先联系谁」分 4 段显示了；拿 CTS 1010 人 / NAL 197 人真数据渲染过真页面
status: done
owner: agent
decided_on: 2026-09-27
source: session:5b9407a2
done_on: 2026-09-27
done_ref: pr:2089
verify_by: 2026-10-04
verify_how: 跑 `npx tsx --tsconfig scripts/tsconfig.probe-ui.json --env-file=<.env.local> scripts/probe-crm-priority-ui.ts`（换 clientId 再跑一次 NAL `4ae76381-cd45-43bd-85cd-98cfd7604007`）。判成：每一项都是 ✅，尤其「收起来的段也画出段头」和「人数 = 接口给的 total」。人数跟今天不一样是正常的（新私信天天进），但**四段人数之和必须等于该客户联系人总数**——对不上先跑 probe-crm-priority-view.ts 看是接口算错了还是页面画漏了
---
这一页原先只按「最近联系时间」平铺，**谁该先被联系看不出来**。现在多一个按钮切到 4 段：客人在等你 / 还没搭上话 / 先放着系统盯着 / 不在今天名单。口径跟「今天要联系」那一页共用同一套判据，不是这一页自己另算。默认仍是平铺，老用户打开看到的东西一个字没变。

当场试跑（生产真数据喂进真页面，不是手搓假数据）：
- CTS 1010 人 → 217 / 74 / 643 / 76，自定义列「感兴趣的团」也跟着出来了
- NAL 197 人 → 22 / 7 / 167 / 1
- 两个客户 13 项检查全绿：收起来的段照样显示段头和人数、人数认接口给的 total、展开的段每个人都画出来、点段头真的带着它重新要数据

试跑当场抓到两处，都在合并前改掉了：
1. **探针自己判错**：CTS 有个客人把备注写进了姓名栏（`Hong  Nguyen. no  pbone  call please`，中间双空格）。页面画出来了，探针却报「少 1 个」——testing-library 会规范化 DOM 里的文字但不规范化你传进去的字符串。狼来了比不报更糟，已压空白后重跑全绿。
2. **为了能验真路径，顺手把 `responseRowFor` / `stageMetaOf` 从 678 行的路由文件搬进 `lib/crm/contact-response-row.ts`**。不搬的话脚本导不出这两个函数，只能自己另写一份「差不多的行」去喂页面——那验的是另一条路。2026-09-26 NAL 止血就是栽在这：验了「Meta 会放行」，没验「我们自己的代码会放行」。

还欠着的：`crm/all/page.tsx` 现在 965 行，超了仓库的 800 行线。R6 第二轮（把 ContactDetail / MarkWonPanel / ImportantMarkerEditor 也搬出去）下一轮做，主干上现在没别人动这块目录了。
