---
id: 2026-10-20-chinatravel-tracking-event-fixes
title: 官网追踪事件小修：留资不带假价值、感谢页不再重复记留资、团页新增查看内容事件、订阅事件改名
status: done
owner: agent
decided_on: 2026-10-20
source: session:ec90bb17
verify_by: 2026-10-23
verify_how: Meta 数据集近期事件里留资事件仍在到达且不带价值；团页打开一次只出一个查看内容事件（用官方接口读事件统计，或像素助手）；订阅类自定义事件 NewsletterSignup 出现；没有投放在用旧的订阅事件
done_on: 2026-10-20
done_ref: doc:docs/ledger/2026-10-20-chinatravel-tracking-event-fixes.md
---
官网 PR 251、252 已合并上线。谷歌广告里那条固定 1 元的转化值没动，要有人看一眼广告后台再定，已写在 PR 里。
核对过：官方广告账户的自定义受众和广告组没有用订阅事件，所以改名不影响投放。
还没做、要人跟进：
1. 谷歌广告「预约服务」转化仍带固定 1 元：要有人看广告后台那个转化动作的价值设置，再决定改不改。
2. 团页「每次只出 1 个查看内容事件」没在生产构建上实测（本地开发模式因严格模式看到 2 个）：上线后用事件统计或像素助手核对。
3. 订阅自定义事件的去重编号：官方文档没给例子，将来做服务端回传（A 级）时用测试事件工具确认。
4. 广告点击编号取「首次触点优先」，同一会话再点另一条广告不会更新；浏览器 cookie 与谷歌点击编号没转发（属服务端回传，A 级）。CRM 解析请引用官网 PR 252（邮件新行标签「Facebook click ID」）。
5. /campaigns/fire-fuzz、/campaigns/chongqing 已永久跳转，但 fire-fuzz 仍在共享区块测试清单里：可另开小清理，不急。
