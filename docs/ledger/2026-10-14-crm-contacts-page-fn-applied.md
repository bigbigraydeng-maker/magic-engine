---
id: 2026-10-14-crm-contacts-page-fn-applied
title: 名单提速函数已应用到生产库（PM 在统筹窗口回「建函数」）：默认打开 2.2→1.4 秒，搜索 1.2–1.5→1.0–1.25 秒
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2605
source: pr:2605
verify_by: 2026-10-21
verify_how: 函数 crm_contacts_page_by_latest_touch 在生产库存在；anon/authenticated 不可执行；名单接口默认约 1.4 秒
---
apply_migration 用的是已合并迁移（文件名 crm_contacts_page_by_latest_touch）的原文；读回：只读（stable、非 security definer）、anon/authenticated 不可执行（set role anon 调用被拒）、service_role 可执行；只读调用返回 100 行、总数 1175。线上实测（PM 的 Chrome，含网络，网络加鉴权的底 0.54 秒）：默认 1.4–1.56 秒，搜索 1.0–1.25 秒，第二页 1.4–1.6 秒，阶段筛选 1.4–1.65 秒。回滚：drop function public.crm_contacts_page_by_latest_touch(uuid, text[], text, uuid[], uuid[], integer, integer)，路由会自动退回应用层路径。
