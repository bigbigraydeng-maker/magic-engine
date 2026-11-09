---
id: 2026-10-14-crm-contacts-page-fn-followups
title: 后续：十万级来往记录时，名单函数的「最新来往」聚合改成按人逐个走索引；PostgREST 的 * 通配与函数里的字面 * 的细微差别待核
status: decided
owner: agent
decided_on: 2026-10-14
source: pr:2594
verify_by: 2026-11-14
verify_how: 来往记录超过 5 万条、或名单接口服务端耗时超过 1 秒时，把 last_touch 改成 lateral 子查询（走 contact_time 索引），并在 PM 的 Chrome 里量前后
---
PR 2594 两审（子牙、魏征）留下的可选项：①当前 1175 人/6.5k 条来往记录毫秒级，放大到十万条后每次请求整客户聚合，且与搜索词无关；②老路由经 PostgREST 的 ilike 会把 * 当通配，函数里 * 是普通字符，沙盘没有 PostgREST 没法核。
