---
id: 2026-09-26-radio-button-invisible-fix
title: 广告健康页「自治模式」单选按钮在白色卡片上不可见
status: done
owner: agent
decided_on: 2026-09-26
source: session:e047d90b
done_on: 2026-09-26
done_ref: pr:2018
verify_by: 2026-09-27
verify_how: 部署后打开 /dashboard/clients/c0000000.../ads-health，卡片里「日预算上限」和「素材池」之间应能看到「自治模式」标签和两个金色圆圈的 radio 按钮（只巡察不动钱 / 信封内自动执行）。同时检查设置页的其他 radio 按钮（客户状态、GBP 选点）也正常显示。
last_checked: 2026-09-27
check_note: 判不了：要登录后看页面，夜巡开不了；只查到主干 globals.css 第 18 行已排除 radio/checkbox（代码在，不等于页面看得见）
---
globals.css 给所有 input 设了 `background-color: #ffffff`，波及了 radio/checkbox；
配合 Tailwind Preflight 的 `border-width: 0`，radio 圈变成白底无边框，在白色卡片上不可见。

修了两处：globals.css 排除 radio/checkbox，autonomy-settings 的 radio 加 `accent-me-ochre`。
