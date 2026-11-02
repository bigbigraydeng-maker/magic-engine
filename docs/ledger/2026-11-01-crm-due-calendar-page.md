---
id: 2026-11-01-crm-due-calendar-page
title: CRM「到期日历」页面：月历显示客人约好的回电，内部身份另看台账验收日，Google 日历保留
status: done
owner: agent
decided_on: 2026-11-01
done_on: 2026-11-01
done_ref: pr:3480
source: session:96dc6edf
verify_by: 2026-11-02
verify_how: 合并部署后用已登录浏览器打开 CTS 的 /crm/calendar：月历能显示；用测试客人约一个回电，当天格出现「● 1 个回电」且点进去能跳到该客人；顶部「在 Google 日历打开」链接能开；客户角色和受限/演示管理员看不到「◆ 核对」项（接口返回 includesLedger=false），只有不限客户的全局管理员能看到
---
PM 2026-11-01 回「做日历」：ME 内做一个只读月历，同时保留 Google 日历（日后其他销售仍要用）。
内容：本月客人约好的回电（读触点 callback_at，后约盖先约，不要再联系的不排）＋台账里还没验完的验收日（仅内部身份）。
没做：每个销售各自同步 Google 日历（要授权，属 A 级，另问 PM）；在日历上直接改期。
