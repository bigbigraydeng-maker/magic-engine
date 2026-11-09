---
id: 2026-09-28-eastinter-meta-nz-ad-account-slot-full
title: East International 的 Meta Business Manager 广告账户数已满，建不了新西兰元账号
status: decided
owner: pm
decided_on: 2026-09-28
verify_by: 2026-10-05
source: session:e12e5606
verify_how: 查 East International 所属 Business Manager 的广告账户列表，确认已关闭的澳元账号是否已被移除/名额已释放，并现场尝试新建一个新西兰元广告账户，成功建出即算过
---

## 背景

- 从 East Inter Reels 排期这件事里拆出来的独立结论，跟 7 条 Reels 的发布/首评状态无关，不共用同一张卡（原卡：[2026-09-28-eastinter-reels-sep29-oct5](./2026-09-28-eastinter-reels-sep29-oct5.md)）
- 澳元账号已确认 CLOSED（状态码 101），账户 ID 见 session:e12e5606（不进台账）
- 所属 Business Manager 广告账户数已满 5/5，API 无法新建新西兰元账号

## 阻塞

需 PM 联系 Meta 客服释放名额或加上限；具体账户 ID / BM ID 见 session:e12e5606（账户号属客户业务事实，不写进台账）。

这件事已接入今日待办「系统进不去、要你点一次的」栏（`src/lib/pm-todo/client-doc-manual-tasks.ts`），
带直达 Business Settings 广告账户列表的链接，不再只停在本卡正文里；`owner` 改成 `pm`（能操作的只有 PM，
agent 联系不了 Meta 客服），并设 `verify_by: 2026-10-05`，拖过这天夜巡会当「决定了没人动」拎出来
（Codex 2026-09-28 复审第 3 轮 PR #2173）。
