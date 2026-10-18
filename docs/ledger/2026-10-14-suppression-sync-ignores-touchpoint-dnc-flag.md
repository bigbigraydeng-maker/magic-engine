---
id: 2026-10-14-suppression-sync-ignores-touchpoint-dnc-flag
title: 每日抑制同步只看联系人那一列和结果值，漏看触点上的别再联系标记；CTS 已有 1 位因此在 9/25 起没被标，收过两封群发
status: decided
owner: agent
decided_on: 2026-10-14
source: session:e004fe1b
verify_by: 2026-10-16
verify_how: "10/15 晚（新西兰 18:20 同步跑完后）只读查 Mailchimp：2d4fa2、cfff53、d528a2、bc888b 四位是否都带抑制标签；10/16 周四群发前用数据库该列重算排除名单；修缺陷后再查触点带标记但没标签的人应为 0"
---
缺陷：src/app/api/cron/mailchimp-suppression-sync/route.ts 读触点时只带 outcome 和时间，没带触点上的 do_not_contact 标记；别处（dnc.ts 的用法）都带。
后果：只有触点标了、联系人那一列没标时同步看不到；这位 9/23 导入时触点已标，那一列 10/14 才被巡检补上，期间收过 9/28 和 10/8 两封群发。其余 6 位同类的因另有结果值已被标。
修法：读触点时把 metadata.do_not_contact 一并传入；这是修缺陷，不是新功能，等开发窗口认领。
