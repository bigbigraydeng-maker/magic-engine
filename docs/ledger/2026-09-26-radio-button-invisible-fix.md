---
id: 2026-09-26-radio-button-invisible-fix
title: 广告健康页「自治模式」单选按钮在白色卡片上不可见
status: done
owner: agent
decided_on: 2026-09-26
source: session:e047d90b
done_on: 2026-09-26
done_ref: pr:2018
---
globals.css 给所有 input 设了 `background-color: #ffffff`，波及了 radio/checkbox；
配合 Tailwind Preflight 的 `border-width: 0`，radio 圈变成白底无边框，在白色卡片上不可见。

修了两处：globals.css 排除 radio/checkbox，autonomy-settings 的 radio 加 `accent-me-ochre`。
