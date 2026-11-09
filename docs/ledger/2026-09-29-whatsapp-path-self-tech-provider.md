---
id: 2026-09-29-whatsapp-path-self-tech-provider
title: PM 拍板——WhatsApp 接入不走 360dialog，ME 自己申请 Meta 技术服务商；取代 9-26「先不花、暂停」
status: decided
owner: pm
decided_on: 2026-09-29
source: session:5b9407a2
verify_by: 2026-10-13
verify_how: "打开 developers.facebook.com → Magic Engine Messaging 应用→ 应用审核，看 whatsapp_business_messaging 和 whatsapp_business_management 两项是否已提交/已批；没提交就查卡在哪一步（WhatsApp 用例没加 / 演示录屏没录 / 测试号没配），按那一步继续推"
---
取代 `2026-09-26-whatsapp-crm-no-spend-park`：PM 9-29 回「360dialog 完全忽略，我们应该可以申请成为 Tech partner」。
同日用 Meta 开发者工具查实：ME 两个应用都显示企业验证已通过；「Magic Engine Messaging」已上线、可提交审核；Meta 官方技术服务商文档没有白名单/关闭字样。9 月「入口关闭、不够格」的判断很可能出在当时企业验证没过，现在前提已变。
下一步：加 WhatsApp 用例 → 录两段演示 → 提交两项高级权限审核 → 批下来后做客户一键授权开户（选并存）。提交审核是对外动作，要 PM 点头。方案见 `docs/specs/2026-09-29-crm-omnichannel-plan-v1.md` 第 1 段。
