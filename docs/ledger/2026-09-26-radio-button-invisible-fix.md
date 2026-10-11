---
id: 2026-09-26-radio-button-invisible-fix
title: 广告健康页「自治模式」单选按钮在白色卡片上不可见
status: done
owner: pm
decided_on: 2026-09-26
source: session:e047d90b
done_on: 2026-09-26
done_ref: pr:2018
verify_by: 2026-09-27
verify_how: 部署后打开 /dashboard/clients/c0000000.../ads-health，卡片里「日预算上限」和「素材池」之间应能看到「自治模式」标签和两个金色圆圈的 radio 按钮（只巡察不动钱 / 信封内自动执行）。同时检查设置页的其他 radio 按钮（客户状态、GBP 选点）也正常显示。
last_checked: 2026-10-09
check_note: 连续两晚判不了(9-27/9-28)：验收要求登录后看生产页面渲染，夜巡没有登录态；代码修复(globals.css排除radio/checkbox+accent-me-ochre)确认还在主干，交人工看一眼（2026-10-09 夜巡：本晚未取到新实证，原结论保留不变）
---
globals.css 给所有 input 设了 `background-color: #ffffff`，波及了 radio/checkbox；
配合 Tailwind Preflight 的 `border-width: 0`，radio 圈变成白底无边框，在白色卡片上不可见。

修了两处：globals.css 排除 radio/checkbox，autonomy-settings 的 radio 加 `accent-me-ochre`。
