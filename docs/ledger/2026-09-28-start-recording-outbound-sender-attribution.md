---
id: 2026-09-28-start-recording-outbound-sender-attribution
title: PM 拍板——往来记录从现在开始记「这通电话/邮件/私信是谁发的」
status: decided
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
verify_by: 2026-10-12
verify_how: 挑一周内新产生的电话/邮件/私信出站记录，抽 20 条查 `contact_touchpoints` 或对应表里「谁发的」字段是不是非空——若还是空，说明写入侧改动没落地
---

## 背景

`docs/specs/2026-09-27-crm-contact-drawer-v0.md`（实为 v1）§6 留了一条待 PM 拍板的问题：现在的「谁发的」字段几乎全是空的——2074 条出站记录里只有 20 条记着人（全部来自 ME 里手工记的那 22 笔）；电话、邮件、私信三大块（合计 2008 条）一条都没记。

PM 拍板：**记**。

## 这不是今晚在做的抽屉改版的一部分

spec §5 说得很明确：三态显示（机器/真人/不知道）P2 要等「写入侧开始标记」，而那是**另一份「状态模型」稿子的事**，不是这份抽屉稿子的事。这次拍板只是解除了那份状态模型稿子的一个前置阻塞，不改变今晚正在做的 P1（抽屉容器/导航/多人协作/文案）范围。

## 下一步（不在今晚做）

需要单独排期：给电话（sheet_followup / me_manual）、邮件（microsoft_mail / outlook）、私信（messenger）三条出站写入路径都加上「谁发的」这个字段的赋值。工作量集中在写入侧，不是读侧——spec 里已经验证过读侧字段和判据函数（`isAutomatedTouch`）本身是好的，只是没人往里面填值。
