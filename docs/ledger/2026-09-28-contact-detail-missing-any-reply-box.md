---
id: 2026-09-28-contact-detail-missing-any-reply-box
title: 「全部客人」页的展开区一直没有回复框——不只是缺 WhatsApp，Messenger 和邮件也没有；这次只补 WhatsApp
status: decided
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
verify_by: 2026-10-05
verify_how: PM 在「全部客人」页搜手机号找到刚测试的那个联系人、点开，看抽屉里有没有出现「📱 在这里直接回他的 WhatsApp」——这是 PM 当场撞到的真实缺口，不是我自己想出来的场景
---

## 怎么发现的

PM 在「全部客人」页测试当晚新接的 WhatsApp 功能，点开测试联系人，发现两件事都不对：
1. 最近的往来没显示出来（另一条，见下）
2. **点开的不是抽屉式弹窗，是行内展开** —— 而且没有任何回复框

第二条一查，发现是我漏了一半：我建的 `WhatsAppReply` 只接进了 `PersonDrawer.tsx`（「今天要联系」页用的组件），没接进 `ContactDetail.tsx`（「全部客人」页用的，是完全独立的另一个组件）。

## 查证结果比想的更大

**`ContactDetail.tsx` 现在一个回复框都没有** —— 不是只缺 WhatsApp。逐行读过：只有电话链接、邮箱链接、「记一笔」（补录，不是真发消息）、改状态。Messenger 和邮件的回复能力只在 `PersonDrawer.tsx`（今天要联系页）上有。

这是历史遗留：`ContactDetail.tsx` 文件头自己的注释说是"从 page.tsx 原样搬出来，一行逻辑没改"（R6b，2026-09-27），搬家那次没有把 R1 给 `PersonDrawer` 加的三块回复框一起搬过来 —— 两个组件各自演化，没人做过"两页功能对齐"的检查。

## 这次只补 WhatsApp

范围理由：今晚的任务是把 WhatsApp 接进来，PM 当场测试撞到的正是这一条。Messenger / 邮件的同款缺口不是今晚引入的，也不阻塞 WhatsApp 上线 —— 记这张卡，留给下一轮或专门排期，不在这次顺手改，避免任务边界扩大。

## 改了什么

- `src/app/api/clients/[id]/crm/contacts/route.ts` 的三条响应路径（`getPaged` / `getPriority` / 拉全 fallback）都加了 `viewerEmail`（从 `access.user.email` 读，本来就有，只是没往外传）——「全部客人」页读它，是「发出去会记在谁名下」那句提示的唯一数据来源，跟「今天要联系」页从自己的 `data.viewerEmail` 拿是同一个模式，没有新起接口。
- `ContactDetail.tsx` 接进 `WhatsAppReply`（复用 `PersonDrawer` 那份组件，零新逻辑）。

## 纠正我自己说过的一句话

我早前把「curl 打生产环境返回 401 而不是 404」当成"新接口已经注册"的证据。这个判断不严谨：401 也可能是更前面的统一登录检查拦下的，不能证明具体某条接口真的存在。真正算数的是 PM 在页面上实际点出来看没看到。

## 当场试跑

`npx tsc --noEmit` 干净；`npx vitest run`（crm/all + crm/contacts，排除下面提到的既有失败）→ 8 文件 / 85 条全过，含新加的 3 条接线测试。变异实测：整段删掉 `<WhatsAppReply>` 渲染 → 3 条里 2 条按预期变红，测试名跟主张对得上。

**未运行**：认证态下的真实端到端（本地开发服务器需要登录会话，curl 只能拿到 401，判不出接口存不存在）。判据写在上面 `verify_how` —— 等 PM 部署后在页面上实测。

## 顺手发现、未处理的既有问题（记录，不在本次修）

`src/app/dashboard/clients/[id]/crm/all/__tests__/nal-mark-won-panel.test.tsx` 三条测试本来就是红的，跟本次改动无关——用 `git stash` 隔离验证过：不带我的改动、同一份代码基线，照样红。测试用的 mock fetch 响应形状（`{ contacts, totalContacts, columns }`）跟路由现在的分页响应形状（`{ items, total, page, perPage, columns }`）对不上，大概率是 R6b/R7 那轮改了响应形状后这个测试文件没跟着更新。需要单独一张卡跟进，不在这次捎带修。
