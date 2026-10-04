---
id: 2026-10-04-me-self-activate-messenger-ad-not-built-yet
title: 「ME 自己点开启私信广告」暂不做：PM 判定原方案过度开发，开启仍由授权人在 Meta 后台手动点
status: decided
owner: pm
decided_on: 2026-10-04
source: session:6b59f1ad
verify_how: 本卡是「暂不做」的记录，不设到期日；PM 决定启动时再开新卡，并从 feat/me-ads-activation-gate 分支的设计稿 v3 重新评估范围
---
原方案（授权动作、紧急开关、每日总预算、卡死巡检等）约 4750 行还没做到一半，PM 拍板走精简路线。
全部已写好的零件存档在分支 feat/me-ads-activation-gate，设计稿 v3 也在该分支，不要合并。
等 PM 决定要做时再启动；在那之前 ME 的「开」按钮对私信广告一律拒绝。
