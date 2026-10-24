---
id: 2026-10-25-crm-non-enquiry-senders-and-retire-decisions
title: CRM 两件 P0：机器人/供应商通知/推销不再出现在「今天要联系」（挪到「先放着」并写明原因，不删不藏），今日决策清单页退役并入「Magic Engine 智能」（PM 回「修」）
status: decided
owner: pm
decided_on: 2026-10-25
source: session:96dc6edf
verify_by: 2026-11-08
verify_how: 合并部署后，①打开 CTS 的「全部客人 → ✨ Magic Engine 智能 → 今天要联系」，第一屏不应再出现 ZORAVYO(outreach@nzingadigital.com)、Afterpay Team、Vietnam Tours Direct、numbers-regulatory-review@twilio.com、guardian-reports@mail.grokbot.com、chajense@chajense.com、WhatsApp Business 这 7 个；②展开「先放着」能找到他们，原因写着「看着不是客人来咨询（…）」，抽屉和历史都在（= 没有凭空消失）；③访问 /dashboard/clients/<CTS>/crm/decisions 应自动跳到 /crm/all?view=smart，导航条上不再有「决策清单（只读）」；④本地跑 `npx vitest run src/lib/crm src/app/dashboard/clients` 应全绿
---
起因：PM 2026-10-25「这个窗口开始负责 CRM 持续优化，站在用户视角体验」。我用他已登录的 Chrome 只读逐页实测 6 个 CRM 页面，清单见 docs/audits/2026-10-25-crm-pages-user-view-audit.md。按 §11 三维打分，两件判为 P0（频率高 / IMPACT 高 / 收入高），PM 回「修」。

**P0-1 垃圾来信排在「今天要联系」第 5 位**。根因：PM 10-21 要的「只留有效咨询」筛选器（src/lib/crm/enquiry-screen/）虽已合并，但 `grep decideScreen` 在名单路由和 contact-list-view 里零命中——当时设计就是「开关先关、机器不自动移人」，等于需求没落地。
做法：新增**纯确定性**判据 `senderShapeOf`（只看发件地址和显示名的形状，不读消息内容、不调模型），命中就把这个人从「今天要联系」挪到「先放着」，并写明原因。三条边界：只降不升（本来就在「先放着」的不动）、只挪不删（全部客人/先放着/抽屉/历史全在）、纯函数判错的代价是少看一眼不是丢客人。复用了既有的 RELAY_DOMAIN_SUFFIXES，没有重画一套。
当场试跑（CTS 真实数据 1210 人 / 6952 条触点，只读）：今天要联系 372 → 365，挪走 7 人，逐个核对全是真垃圾（Twilio 系统通知、Afterpay 营销、Mailchimp 群发、推销、机器人、平台系统账号），真客人一个没动；复查「今天要联系」里剩余垃圾发件人 = 0。另对全库 1210 人单独跑判据，命中 9 人（0.7%），无误伤。

**P0-2 今日决策清单页**：和「Magic Engine 智能」是同一批人同一套建议，但它是最慢的一页（实测打开 8.3 秒，`/api/clients/[id]/crm/today` 一个接口 6.9 秒/79KB），而且按「等了多久」排序 → 等了 127 天的排最前、昨天刚进线的真客人排到第 300 多位。
做法：该页改成跳转到 `/crm/all?view=smart`（保留老书签），导航条移除入口。顺带让「智能」视图可以用网址直达（以前只是页面里的开关，刷新就回平铺名单）。

遗留：`/api/clients/[id]/crm/today` 和 `src/lib/crm/decision-list.ts` 现在没有界面在用，留着没删（另开卡清理）。审计清单里的 P1/P2/P3（团名显示机器代号、待认领页混进系统邮件、重复客户档案、测试数据在名单里）本轮没做。
