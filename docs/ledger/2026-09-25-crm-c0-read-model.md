---
id: 2026-09-25-crm-c0-read-model
title: CRM 升级 C0：GET /crm/contacts 加分页/筛选/搜索；无参数=老行为不变
status: done
owner: pm
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-09-30
verify_how: PR 合并后 all/page.tsx 无改动仍能拿到老响应；带 ?page=1&perPage=100 调用能拿到 paged 响应；对 CTS 客户 stage=quoted 筛选人数与 Supabase Studio 上直查一致
done_on: 2026-09-25
done_ref: pr:2001
last_checked: 2026-10-19
check_note: 10-19：PR 2001 已合并(09-24)；主干 crm/contacts/route.ts 与其测试含 perPage 参数；线上带参调用与 Supabase 比人数需登录态，夜巡做不了，判不了；owner 已是 pm
---
CRM 升级 6 轮（方案 pr:2000）第一轮，DeepSeek 1 轮 $0.02，Fable 窗口出提示词 + 复审 + 修类型错。
