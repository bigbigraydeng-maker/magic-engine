---
id: 2026-09-28-ledger-has-no-cancelled-state
title: 台账四种状态里没有「已取消／被取代」，于是一件取消掉的事只有两个下场：天天催 PM，或者被标成「验过了、成」说谎
status: decided
owner: agent
decided_on: 2026-09-28
source: pr:2151
verify_by: 2026-10-26
verify_how: 造一张「被取代」的卡跑 `walkLedger`，它必须**不再**产出待办，而卡本身仍能看出「没做成、被谁取代」——两件同时成立才算修好。只满足前一件（比如允许标 verified 了事）= 没修，那是用假的成功换清静；只满足后一件 = 还在天天催。另查它认不认 `verified_ref` 指向的接替卡，或者是否新加了第五种状态，两种实现都可以，但必须能机器识别，不能靠正文写一句「已失效」
---
2026-09-28 实测：`src/lib/ledger/walk.ts` 的 `classify` 里，`verified` 直接 `return null`（不再出现），而 `failed` **无条件**变成 `verification_failed` 待办，没有任何按 `verified_ref` 或接替卡抑制的分支（Codex 复审指出，卫青读码确认）。
**撞上它的实例**：15 秒素材重测那张卡（[[2026-09-26-nal-messenger-15s-retest]]）因为所在广告系列 9/28 被整个停投而**取消**——它既不是「验过了成」，也不是「判出来不成」，而是没机会跑。`failed` 会天天催 PM「重做或关闭」一件已经取消的事，所以权宜地把它标成 `verified`，并在 check_note 写明「取消、不是判出结果」、verified_ref 指向取消记录——这是权宜，不是真成功。
**权宜做法的代价**：`verified` 的定义是「验过了、成」，把取消的卡标成它会让统计把取消当成功，所以读这类卡必须看 check_note；这正是要修的毛病，不能当长期做法。
**优先级（§11）**：频率 低（偶尔才有卡被取消）/ IMPACT 低（不在产品闭环）/ 收入 低 → 三个低 → **P3** 待认领。在它修好之前，取消类的卡暂标 `verified`，`check_note` 必须以「取消，不是成功」开头。
