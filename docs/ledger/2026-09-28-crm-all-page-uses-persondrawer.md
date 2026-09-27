---
id: 2026-09-28-crm-all-page-uses-persondrawer
title: 「全部客人」详情换成完整抽屉（PersonDrawer），删掉简化版 ContactDetail，加了并发改档保护
status: done
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
done_on: 2026-09-28
done_ref: pr:2165
verify_by: 2026-10-05
verify_how: "登录生产 ME，打开 CTS 或 NAL 的「全部客人」，点开任意一个人：能看到私信/邮件/WhatsApp 回复框、一键动作按钮；点「上一位/下一位」能正常切换、翻到下一页会自动打开新一页第一个人；两个人同时改同一个联系人的跟进阶段，后手那个应该看到「已经被别人改过」的提示而不是静默覆盖"
---
「全部客人」页原来点一行是就地展开一块简化的 ContactDetail（没有私信/邮件回复、没有一键动作），跟「今天要联系」页用的 PersonDrawer 抽屉是两份重复代码，各缺一半功能。这次统一换成 PersonDrawer，删除 ContactDetail.tsx，并加了「上一位/下一位」跨段/跨页导航。

顺带在实现过程中过两轮复审（子牙架构 + 魏征挑刺）查出并修了三个真实缺口：
1. 接口响应行漏了 `suggestedChannel`/`reason` 字段，抽屉会兜底成"打电话"话术
2. 并发改档保护对"还没标过阶段"（stage=null）的联系人一开始是失效的——这恰好是两人同时抢着标第一下最容易撞上的场景
3. 补集成测试时抓到一个真实的翻页 bug：抽屉翻到下一页会被另一个 effect 误判成"人消失了"整个关掉，根因是两层 React 状态时序坑

同一批还顺手修了一个无关的老测试 bug：`nal-mark-won-panel.test.tsx` 从分页改造上线后就没真的跑通过 3 条测试，一直静默红。
