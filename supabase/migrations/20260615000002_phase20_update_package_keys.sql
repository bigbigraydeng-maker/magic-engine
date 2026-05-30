-- Phase 20 pricing correction
-- Update mtc_purchases.package_key CHECK constraint to new pricing tier keys.
-- Old: starter_29 / growth_79 / scale_199 / bonus_100
-- New: starter_99 / growth_249 / scale_599 / bonus_500

ALTER TABLE mtc_purchases
  DROP CONSTRAINT IF EXISTS mtc_purchases_package_key_check;

ALTER TABLE mtc_purchases
  ADD CONSTRAINT mtc_purchases_package_key_check
    CHECK (package_key IN ('starter_99', 'growth_249', 'scale_599', 'bonus_500'));
