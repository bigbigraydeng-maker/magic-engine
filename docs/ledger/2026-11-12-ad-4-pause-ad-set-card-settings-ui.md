---
id: 2026-11-12-ad-4-pause-ad-set-card-settings-ui
title: 客户设置页展示并切换「暂停广告组确认卡」开关（AD-4 UI）
status: done
owner: agent
decided_on: 2026-11-12
source: session:cloud-agent-ad4
verify_how: vitest 跑 PauseAdSetCardSwitchPanel 与 usePauseAdSetCardSwitch；设置页接通分组加载后开关与 GET 一致，POST 被拒时界面回退并显示接口原文案
done_on: 2026-11-12
done_ref: commit:bc9c0af23
---

AD-4 B 级 L2：只接既有 ad-strategy-config/pause-ad-set-card，不改 API。为客户逐户开关；不为任何客户默认打开（含 CTS，等 Ray）。
