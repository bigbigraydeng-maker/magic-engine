---
id: 2026-10-05-cts-messenger-realtime-push-setup
title: 打通 CTS 主页私信实时推送：先关 CTS 自动回复开关，再订阅 Meta，最后用 PM 账号实测
status: decided
owner: agent
decided_on: 2026-10-05
source: session:316495bb
verify_by: 2026-10-08
verify_how: PM 用自己账号给 CTS 主页发一句话，conversation_messages 里该条 created_at 与 sent_at 相差小于 1 分钟才算通；样本 1 条只能证明通，不能证明稳
---
已查实：线上 Messenger 接收入口的验证口令与验签密钥都已配置（探针返回 403/401）；docs/ENV.md 的「待配」已过时。
未查清：CTS 主页授权来自哪个应用（候选之一（编号见该窗口记录）），与验签密钥是否同一应用未验证；不一致则推送会被全部拒收。
红线：推送一通，CTS 现开着的自动回复会对真实客人外发，必须先关开关再订阅。改 Meta 后台前须 PM 回「合」。
若 Standard Access 推不到普通客人，退路是为 CTS 加更勤的只拉新私信同步，不硬推审核。
