-- 阶段 0 · 真客户闸门 (DataForSEO 接入计划前置)
-- spec: docs/superpowers/specs/2026-08-01-dataforseo-integration-plan.md § 阶段 0
--
-- clients 表混着真客户和 Discovery 调研档案，现有监测 cron 用
-- `domain IS NOT NULL` 选客户，过半是调研壳子在白烧 API 钱。
-- 加 client_status 区分：active 真客户 / prospect 调研（默认）/ archived。
-- 所有周期性监测 cron 的选客户条件统一改为 client_status = 'active'。

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_status text NOT NULL DEFAULT 'prospect';

DO $$ BEGIN
  ALTER TABLE clients
    ADD CONSTRAINT clients_client_status_check
    CHECK (client_status IN ('active', 'prospect', 'archived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 自有品牌 Magic Engine 此前无档案，一并建档（PM 2026-08-01 确认 8 家真客户名单）。
-- 幂等：按 name 判重，重跑不重复插入。
INSERT INTO clients (name, domain, semrush_db, country, city, source)
SELECT 'Magic Engine', 'magicengine.com.au', 'au', 'AU', NULL, 'fde'
WHERE NOT EXISTS (
  SELECT 1 FROM clients WHERE lower(name) = 'magic engine'
);

-- 回填：8 家真客户标 active（外部 5 + 自有品牌 3），其余保持默认 prospect。
-- CTS / Oztop / Roman HU / 30 Kiteroa / Parkhomes(并档后保留的 19e025b7)
-- / Magic Lab / Magic Lab Class / Magic Engine(上面刚建)
UPDATE clients
SET client_status = 'active'
WHERE id IN (
  'c0000000-0000-0000-0000-000000000000', -- CTS Tours NZ
  'd5c98811-1c1d-4ded-bdf0-4cefec6afb84', -- oztop
  'e7465ac7-4f3d-4d6a-afbe-d036ab419708', -- Roman HU
  '5a3fb2b7-72c3-471e-a5e7-1a528c0f776c', -- 30 Kiteroa Rothesay Bay
  '19e025b7-555b-44fd-ba87-debc62a447a7', -- Parkhomes
  '5e9d67f2-0ffe-4093-95ca-54c9e713d9bf', -- Magic Lab
  '377468af-b103-45f0-984a-b353febb56a1'  -- Magic Lab Class
)
OR lower(name) = 'magic engine';
