---
id: 2026-10-13-cts-enquiry-definition-form-and-organic-report
title: CTS「一条询盘」口径定了，官网表单记「第一次进站页」（已合并），ME 自然搜索询盘只读报告（已合并、试跑通）
status: done
owner: pm
decided_on: 2026-10-13
source: session:1706645b
verify_by: 2026-10-21
done_on: 2026-10-13
done_ref: pr:2525
verify_how: 官网表单改动（chinatravel#232，10-12 已合并）上线后第一个整周（10-21 看）：①GA4 后台能看到 enquiry_thank_you 事件；②手动试跑 ga4-organic-landing-leads（传 CTS 客户编号）返回非空；③请有 info@ 权限的人按文档 §4 对账一次，新事件与邮箱封数差 ≤10% 算成。
---
口径文档：docs/clients/cts/2026-10-13-cts-enquiry-definition-and-form-spec.md。官网改动 chinatravel#232（A 级，PM 10-12 合并），ME 取数函数 magic-engine#2525（A 级，PM 10-12 合并）。
还没做：GA4 里把 viewed_tour_paths 注册成自定义维度（一次性后台设置）；定制行程表单未覆盖。官网已有问题（非本次引入）：重庆定制页成功后跳 /enquiry-thank-you，站内没有该页面（404），需官网窗口处理；/api/campaign-enquiry 无人调用。
已做：ME 取数 #2525 已合并，10-12 在线上手动试跑（GitHub Actions「Manual cron trial」10-12 12:27Z 那次运行）：GA4 接受该维度组合、0 失败；官网 #232 PM 于 10-12 合并（风险他接受，CTS 邮箱三问未答）。已加日历提醒 10-21。
