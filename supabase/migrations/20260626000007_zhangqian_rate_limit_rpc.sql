-- ============================================
-- Atomic public-scan rate-limit consume
-- 2026-06-26  Phase X.S6 — Wei Zheng M-4 fix
-- ============================================
--
-- Before: checkScanRateLimits read counters from JS, then recordScanAttempt
-- did SELECT-then-UPSERT separately. Concurrent requests could all pass the
-- check (counters still 0), then race the recordScanAttempt window. Net
-- effect: the 3/day cap could be exceeded by N parallel hits.
--
-- After: a single function does INSERT ... ON CONFLICT DO UPDATE SET
-- count = count + 1 RETURNING count, and ATOMICALLY decides allowed/blocked
-- based on the post-increment value. Concurrent callers serialise on the
-- unique (bucket_type, bucket_key, window_start) constraint.
--
-- Returns one row with the post-increment count and whether it stayed at or
-- below the cap. Caller can short-circuit further DB work when blocked.

CREATE OR REPLACE FUNCTION public.zhangqian_rate_limit_consume(
  p_bucket_type  TEXT,
  p_bucket_key   TEXT,
  p_window_start TIMESTAMPTZ,
  p_cap          INTEGER DEFAULT 3
)
RETURNS TABLE (
  allowed     BOOLEAN,
  post_count  INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  IF p_cap <= 0 THEN
    RAISE EXCEPTION 'cap must be positive (got %)', p_cap;
  END IF;

  -- INSERT-or-INCREMENT in one statement. The constraint on the primary key
  -- (bucket_type, bucket_key, window_start) is what serialises concurrent
  -- callers — Postgres locks the conflicting row for the UPDATE side of
  -- the conflict clause.
  INSERT INTO zhangqian_scan_rate_limits AS r
    (bucket_type, bucket_key, window_start, count, updated_at)
  VALUES (p_bucket_type, p_bucket_key, p_window_start, 1, NOW())
  ON CONFLICT (bucket_type, bucket_key, window_start)
    DO UPDATE SET
      count      = r.count + 1,
      updated_at = NOW()
  RETURNING r.count INTO v_new_count;

  RETURN QUERY SELECT (v_new_count <= p_cap), v_new_count;
END;
$$;

COMMENT ON FUNCTION public.zhangqian_rate_limit_consume(TEXT, TEXT, TIMESTAMPTZ, INTEGER) IS
  'Phase X.S6 M-4 — atomic check-and-increment for public scan rate limit. Returns the post-increment count and whether it''s within cap.';

GRANT EXECUTE ON FUNCTION public.zhangqian_rate_limit_consume(TEXT, TEXT, TIMESTAMPTZ, INTEGER)
  TO service_role;
