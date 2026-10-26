---
id: 2026-10-27-service-pause-only
title: 服务级只暂停入口，总开关默认关
status: decided
owner: agent
decided_on: 2026-10-27
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-10-28
verify_how: Ray 在托管环境把总开关设成开之后，下一次表单留资故障应能暂停并留下操作记录；开关不设或关掉时不得改广告。本卡交付时没有跑生产、没有调真实广告接口。
---

只暂停入口用已有的服务密钥调用，不认登录会话。只能暂停这个客户名下的系列。先写操作记录，写不进去就不改广告。恢复投放不在这里。
