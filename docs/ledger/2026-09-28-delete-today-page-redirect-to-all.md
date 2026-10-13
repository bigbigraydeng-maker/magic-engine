---
id: 2026-09-28-delete-today-page-redirect-to-all
title: 删掉「今天要联系」页，改成跳转到「全部客人」——独有功能 B2/B3/B5 都已搬完
status: done
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
done_on: 2026-09-28
done_ref: pr:2167
verify_by: 2026-10-05
verify_how: "登录生产 ME，敲旧网址 /dashboard/clients/<CTS的id>/crm（不带 /all）——应该自动跳到 /crm/all，不是 404；侧栏「客户跟进」入口点一下应该直接落在 /crm/all，不经过跳转；今日待办里任何「可能被误判成永久拒联」类任务点开应该直接打开对应客人的抽屉"
last_checked: 2026-10-13
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
「今天要联系」原本是系统排好的"今天该打谁"看板（六批人并排、点人开抽屉）。它的每一样独有功能都已经在前几轮搬进「全部客人」：私信/邮件/WhatsApp 回复 + 一键动作（B2）、同行筛选+批量发邮件（B3）、分段"今天进度"（B5）、四段分组（更早的 WP3 R7）。这一轮把页面本身删掉，改成一条服务端跳转（`?contact=` 原样转发），不做成 404。

顺带清理：`CrmTabs.tsx` 去掉"今天要联系"标签；删掉只有那个页面在用的 `QuickNote.tsx`；侧栏主入口、两处客户页引导链接、两处今日待办文案里"点行就地展开"的旧措辞，全部改成指向/描述新的抽屉交互。

魏征复审第一轮就查出侧栏主入口（`dashboard-shell.tsx`）漏改——这是 FDE 天天点的地方，已经修。
