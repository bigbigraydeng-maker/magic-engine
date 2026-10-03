-- 同一个人的成交（purchase）只能有一条有效记录——防「邮件识别」与「表格同步」等不同来源重复发给 Meta。
--
-- 为什么：Meta 的服务端事件之间不去重、发出去撤不回。现有唯一索引只管
-- (client_id, source_kind, source_ref)，邮件来源（source_ref = 邮件 id）和表格来源
-- 互相看不见，同一个人会产生两条 Purchase。这里在数据库层加两道兜底：
--   ① 有 Facebook 线索编号：同一客户同一线索编号只能有一条有效 purchase；
--   ② 没有线索编号：同一客户同一邮箱（不分大小写）+ 同一单号（发票号）只能有一条有效 purchase。
-- "有效" = 没被拒绝、没被删除个人信息。被拒绝的不占位，这样人工拒绝后可以重新录入正确的那条。
-- 两个都缺（既没线索编号、也没邮箱+单号）的情形，数据库挡不住，由识别程序按
-- "近 30 天同联系人已有 purchase 则转人工" 处理（见 docs/specs 设计稿 §3）。
--
-- ⚠️ 只随 PR 提交，apply 需 PM 显式 go。只建两个部分唯一索引，不改任何既有数据；
--    建索引前生产库 purchase 记录数为 0（2026-10-04 只读核实），不会因既有重复而失败。

create unique index if not exists uq_me_sale_outcomes_purchase_per_lead
  on public.me_sale_outcomes (client_id, meta_lead_id)
  where outcome_kind = 'purchase'
    and meta_lead_id is not null
    and review_status <> 'rejected'
    and redacted_at is null;

create unique index if not exists uq_me_sale_outcomes_purchase_per_email_order
  on public.me_sale_outcomes (client_id, lower(customer_email), order_ref)
  where outcome_kind = 'purchase'
    and customer_email is not null
    and order_ref is not null
    and review_status <> 'rejected'
    and redacted_at is null;

comment on index public.uq_me_sale_outcomes_purchase_per_lead is
  '同一客户同一 Facebook 线索编号只能有一条有效 purchase（跨来源防重，Meta 不去重且撤不回）';
comment on index public.uq_me_sale_outcomes_purchase_per_email_order is
  '同一客户同一邮箱+单号只能有一条有效 purchase（没有线索编号时的跨来源防重）';

-- 自验（apply 后只读运行，期望两行）：
--   select indexname from pg_indexes
--    where tablename = 'me_sale_outcomes' and indexname like 'uq_me_sale_outcomes_purchase_per_%';
