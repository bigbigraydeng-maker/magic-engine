---
id: 2026-10-26-meta-token-in-url-legacy-readers
title: 两个老的 Meta 读取函数仍把令牌放在网址里（getPageAccessToken、fetchPageLeadForms），要改成放请求头
status: decided
owner: agent
decided_on: 2026-10-26
source: pr:3196
verify_by: 2026-11-16
verify_how: 到期时在 `src/lib/meta/page-posts.ts` 的 `getPageAccessToken` 和 `src/lib/meta/lead-forms.ts` 的 `fetchPageLeadForms` 里查：访问令牌是否仍拼在请求网址的查询参数里（应改为 Authorization 请求头，同 `plan-seed/deps.ts` 自带只读读取的做法）；并 grep 其它调用 `access_token=` 拼网址的位置，列清单。改完要补一条测试：请求网址里不含令牌、头里有 Authorization。不满足就把 verify_by 往后推并写明卡在哪。
---
2026-10-26 统管 74 对 PR 3195 做最终版事后审计时发现：处方预算建议里复用的两个老函数仍把令牌放在网址里（令牌进网址会出现在代理/访问日志里）。这是 3195 之前就有的老写法，不在 3195/3196 这两刀里修，由本卡认领。处方种子自己新写的只读读取（`plan-seed/deps.ts`）已按「令牌放请求头、异常原文过令牌过滤」做，可作参照。两个老函数被多处调用，改动要单独一刀、单独审（不要顺手混进别的 PR）。
