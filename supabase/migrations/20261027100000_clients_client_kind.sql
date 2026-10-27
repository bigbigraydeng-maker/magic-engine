-- 客户类型：普通 / 个人 IP（个人 IP 处方第一批，issue #3308）。
--
-- 只新增一列，可空，无默认值：
--   - 不改已有列、不删数据、不回填任何客户（空值 = 按普通客户路径处理）。
--   - 取值与代码 src/types/diagnostic.ts 的 ClientKind 一致：'standard' | 'personal_ip'。
-- RLS：clients 表现有策略不变，本迁移不碰策略。

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_kind text;

DO $$ BEGIN
  ALTER TABLE clients
    ADD CONSTRAINT clients_client_kind_check
    CHECK (client_kind IS NULL OR client_kind IN ('standard', 'personal_ip'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN clients.client_kind IS
  '客户类型：standard 普通 / personal_ip 个人 IP。NULL 按 standard 处理。';
