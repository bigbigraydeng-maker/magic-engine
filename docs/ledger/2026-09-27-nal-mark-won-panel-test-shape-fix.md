---
id: 2026-09-27-nal-mark-won-panel-test-shape-fix
title: nal-mark-won-panel 测试跟上 C1a 服务端分页新形状
status: done
owner: agent
decided_on: 2026-09-27
source: session:d9c9c34e
done_on: 2026-09-27
done_ref: pr:2070
---
`all/page.tsx` 在 C1a（PR #2002）切到 `items/total/page/perPage` 并顺手在顶部加了「跟进到哪步」筛选 chip；这份测试的 stub 还留在旧的 `contacts/totalContacts` 上，`findByText('已成交')` 又撞上了新增的同名筛选 chip。把 stub 换成新形状、把 stage 档位按钮用「最后一个」区分开，产品代码不动。
