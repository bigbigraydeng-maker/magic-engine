-- P22.A.3: Add local_pack_rank to keyword_snapshots for GEO Local Pack appearance tracking.
-- NULL = not in Local Pack; 1-3 = position in Local Pack (Google shows max 3 results).

ALTER TABLE keyword_snapshots
  ADD COLUMN IF NOT EXISTS local_pack_rank INTEGER;

ALTER TABLE keyword_snapshots
  ADD CONSTRAINT keyword_snapshots_local_pack_rank_check
    CHECK (local_pack_rank IS NULL OR (local_pack_rank >= 1 AND local_pack_rank <= 3));

CREATE INDEX IF NOT EXISTS idx_keyword_snapshots_local_pack
  ON keyword_snapshots(client_id, snapshot_date DESC)
  WHERE local_pack_rank IS NOT NULL;

COMMENT ON COLUMN keyword_snapshots.local_pack_rank IS
  'Position in Google Local Pack (1-3). NULL if keyword does not trigger a Local Pack or client is not present.';
