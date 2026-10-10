---
id: 2026-10-10-viral-fetch-egress-and-signup-confirm-check
title: 遗留风险：下载工具跟跳转进内网；注册改邮箱的安全设置还没核对
status: decided
owner: pm
decided_on: 2026-10-10
source: session:34af475f
verify_by: 2026-10-17
verify_how: 一，给下载工具加受控出口或网络层禁内网和云元数据地址；二，在 Supabase 后台 Email 提供方展开页核对「Secure email change」是否开启
---
来自 PR 2432 的狄仁杰审查。一的前提是攻击者已能写入网址（目前仅全局管理员），中危。
「注册需邮件确认」已由统筹窗口 2026-10-11 在生产项目只读核实：开（匿名登录关、手动关联关）。所以冒充公司域名邮箱直接成为管理员这条不成立，需真实持有该邮箱。「Secure email change」未核对，仍待查。
