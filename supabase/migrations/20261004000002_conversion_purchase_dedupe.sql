-- 同一封发票（同客户 + 同邮箱 + 同单号）只能有一条有效 purchase —— 防同一张发票被重复发给 Meta。
--
-- 为什么只建这一条：Meta 的服务端事件之间不去重、发出去撤不回。现有唯一索引只管
-- (client_id, source_kind, source_ref)，不同来源（邮件 / 表格同步）互相看不见。
-- 我们起初还想加「同一线索编号只能一条 purchase」，复审时去掉了：同一个客人订第二个团是
-- 合法的第二笔成交，线索级唯一会把它拦下，并且表格同步会把它当成「已同步」静默吞掉。
-- 跨来源的「同一个人已有成交」改由应用层判断（payment-email-detect-run：该联系人已有任何
-- 来源的有效 purchase 就转人工）；这里只兜最确定的一种——同一张发票不能记两次。
-- "有效" = 没被拒绝、没被删除个人信息，所以人工拒绝后可以重新录入正确的那条。
--
-- ⚠️ 只随 PR 提交，apply 需 PM 显式 go；apply 前必须重查生产库现有 purchase 是否已有
--    同邮箱同单号的重复（2026-10-04 只读核实时 purchase 记录数为 0，那只是当天快照）。

create unique index if not exists uq_me_sale_outcomes_purchase_per_email_order
  on public.me_sale_outcomes (client_id, lower(customer_email), order_ref)
  where outcome_kind = 'purchase'
    and customer_email is not null
    and order_ref is not null
    and review_status <> 'rejected'
    and redacted_at is null;

comment on index public.uq_me_sale_outcomes_purchase_per_email_order is
  '同一客户同一邮箱+同一单号（发票号）只能有一条有效 purchase（Meta 不去重且撤不回）';

-- 自验（apply 后只读运行，期望一行）：
--   select indexname from pg_indexes
--    where tablename = 'me_sale_outcomes' and indexname = 'uq_me_sale_outcomes_purchase_per_email_order';
