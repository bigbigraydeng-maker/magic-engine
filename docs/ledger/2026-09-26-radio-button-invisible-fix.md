---
id: 2026-09-26-radio-button-invisible-fix
title: 广告健康页「自治模式」单选按钮在白色卡片上不可见
status: verified
owner: pm
decided_on: 2026-09-26
source: session:e047d90b
done_on: 2026-09-26
done_ref: pr:2018
verify_by: 2026-09-27
verify_how: 部署后打开 /dashboard/clients/c0000000.../ads-health，卡片里「日预算上限」和「素材池」之间应能看到「自治模式」标签和两个金色圆圈的 radio 按钮（只巡察不动钱 / 信封内自动执行）。同时检查设置页的其他 radio 按钮（客户状态、GBP 选点）也正常显示。
last_checked: 2026-10-14
check_note: 线上样式表（app.magicengine.com.au/login 引用的那份 css，今晚取回 144271 字节）里两处改动都在：排除 radio 的 :not([type=radio]) 与排除 checkbox 的 :not([type=checkbox]) 各 1 次，且搜不到 input,select,textarea 的白底裸规则；accent-color 的取值里出现了 tailwind 里 me-ochre 的那个色值 c4912e。没登录态开不了 ads-health 页，改用线上样式表作实证，视觉观感未经人眼复核
verified_ref: doc:docs/ledger/evidence/2026-09-26-radio-button-invisible-fix--2026-10-14.md
---
globals.css 给所有 input 设了 `background-color: #ffffff`，波及了 radio/checkbox；
配合 Tailwind Preflight 的 `border-width: 0`，radio 圈变成白底无边框，在白色卡片上不可见。

修了两处：globals.css 排除 radio/checkbox，autonomy-settings 的 radio 加 `accent-me-ochre`。
