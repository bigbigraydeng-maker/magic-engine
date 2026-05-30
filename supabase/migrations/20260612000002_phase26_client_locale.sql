-- Phase 26 — Client Locale Intelligence
-- Adds locale fields to clients table.
-- semrush_db is preserved for DataForSEO backward compatibility.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS country             VARCHAR(2)   NOT NULL DEFAULT 'AU',
  ADD COLUMN IF NOT EXISTS state_code          VARCHAR(10),
  ADD COLUMN IF NOT EXISTS city                VARCHAR(100),
  ADD COLUMN IF NOT EXISTS business_scope      VARCHAR(20)  NOT NULL DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS locale_confirmed_at TIMESTAMPTZ;

ALTER TABLE clients
  ADD CONSTRAINT clients_business_scope_check
    CHECK (business_scope IN ('local', 'state', 'national'));

ALTER TABLE clients
  ADD CONSTRAINT clients_country_check
    CHECK (country IN ('AU', 'NZ'));

-- Backfill country from existing semrush_db values
UPDATE clients SET country = 'AU' WHERE semrush_db = 'au' OR semrush_db IS NULL;
UPDATE clients SET country = 'NZ' WHERE semrush_db = 'nz';

COMMENT ON COLUMN clients.country             IS 'ISO 2-letter country code: AU or NZ';
COMMENT ON COLUMN clients.state_code          IS 'AU: VIC/NSW/QLD/WA/SA/TAS/ACT/NT  NZ: AKL/WLG/CAN/OTG/HKB/NLS/MBR/STH/TRK/WKO';
COMMENT ON COLUMN clients.city                IS 'Primary city of business (freeform)';
COMMENT ON COLUMN clients.business_scope      IS 'local=city-only, state=whole state/region, national=whole country';
COMMENT ON COLUMN clients.locale_confirmed_at IS 'Set when client confirms locale via dashboard prompt. NULL = using defaults.';
