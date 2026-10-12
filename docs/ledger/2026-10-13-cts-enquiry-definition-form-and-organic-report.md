---
id: 2026-10-13-cts-enquiry-definition-form-and-organic-report
title: CTS「一条询盘」口径定了，官网表单记「第一次进站页」（草稿，待合并），ME 新增自然搜索询盘只读报告
status: done
owner: pm
decided_on: 2026-10-13
source: session:1706645b
verify_by: 2026-10-27
done_on: 2026-10-13
done_ref: pr:2525
verify_how: 官网表单改动合并上线后，选首个整周：①GA4 后台能看到 enquiry_thank_you 事件；②手动试跑 ga4-organic-landing-leads（传 CTS 客户编号）返回非空；③请有 info@ 权限的人按文档 §4 对账一次，新事件与邮箱封数差 ≤10% 算成。官网改动没合并则本卡不算 done，此日期顺延到合并后第 14 天。
---
口径文档：docs/clients/cts/2026-10-13-cts-enquiry-definition-and-form-spec.md。官网改动在 chinatravel 仓库草稿 PR（A 级，PM 合并），ME 取数函数在 magic-engine 草稿 PR（改了 .github 白名单，A 级）。
还没做：GA4 里把 viewed_tour_paths 注册成自定义维度（一次性后台设置）；定制行程表单未覆盖。官网已有问题（非本次引入）：重庆定制页成功后跳 /enquiry-thank-you，站内没有该页面（404），需官网窗口处理；/api/campaign-enquiry 无人调用。
已做：ME 取数 #2525、官网 #232 均已由 PM 合并（10-12）；ME 取数线上手动试跑通过。10-21 的首次出数核对另开新卡 2026-10-13-cts-enquiry-event-first-data-check。
