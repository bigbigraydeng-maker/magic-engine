-- 给联系人加「跟进人」字段。
--
-- 为什么挂 contacts，不挂 conversations：
--   Meta 表单线索进库时只写 contact_touchpoints，conversation 要等客人
--   之后主动在 Messenger / 邮件来一次才建。所以「刚进库的新线索分给谁跟」
--   如果挂 conversations，源头上就没地方记。
--
-- 为什么存登录邮箱，不存 user_id：
--   CTS 员工账号在 client_portal_users 里按 email + client_id 定位；
--   同一个邮箱可能跨多个客户账号（将来），但分配总是在单个客户内发生，
--   所以 (client_id, assigned_to email) 唯一定位一个跟进人。
--
-- 为什么不加 FK：
--   contacts 已有 client_id；assigned_to 跨查 client_portal_users 时在
--   应用层按 (client_id, email) 校验。强 FK 会在导入历史数据 /
--   员工离职删号时制造写回失败。
--
-- 为什么加 index：
--   「我的待跟进」看板主查询是 WHERE client_id = ? AND assigned_to = ?。
--
-- 这一刀只加字段，不写 round-robin 逻辑、不动 meta-lead 落点、不改 UI。

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS assigned_to text;

CREATE INDEX IF NOT EXISTS contacts_client_assigned_idx
  ON contacts (client_id, assigned_to)
  WHERE assigned_to IS NOT NULL;
