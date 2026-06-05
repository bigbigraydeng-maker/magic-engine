-- ============================================
-- Public scan rate limit + per-domain dedup cache
-- 2026-06-26  Phase X.S3 — Wei Zheng H3 fix
-- ============================================
--
-- Old behaviour: in-process Map<ip, { count, resetAt }>. Resets on every
-- Render deploy, every container recycle, and is per-instance — so on a
-- 2-instance Render config the effective limit is 6/IP/day, and a script
-- that switches IPs every request has no ceiling at all.
--
-- New behaviour:
--   1. zhangqian_scan_rate_limits — persistent counter keyed by (bucket_type,
--      bucket_key, window_start). One row per (ip|email|domain) per day.
--      All three dimensions are checked on every public scan attempt.
--   2. zhangqian_scan_domain_cache — when a domain was scanned in the last
--      24 hours, the previous job_id is returned instead of running a new
--      scan. Saves ~$0.57 per duplicate request and stops a hammering script
--      from costing real money.

-- ── 1. Rate-limit counters ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zhangqian_scan_rate_limits (
  /** 'ip' | 'email' | 'domain' — kept as TEXT for forward compatibility. */
  bucket_type   TEXT        NOT NULL,
  /** The lowercased IP / canonical email / domain. */
  bucket_key    TEXT        NOT NULL,
  /** First instant of the rate-limit window the counter applies to (UTC midnight). */
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_type, bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS zhangqian_scan_rate_limits_window_idx
  ON public.zhangqian_scan_rate_limits(window_start);

ALTER TABLE public.zhangqian_scan_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full"
  ON public.zhangqian_scan_rate_limits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.zhangqian_scan_rate_limits IS
  'Phase X.S3 H3 — persistent per-(ip|email|domain) daily counters for public Zhangqian scans. Replaces the in-process Map<ip> that did not survive Render restarts.';

-- ── 2. Per-domain 24h result cache ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.zhangqian_scan_domain_cache (
  domain      TEXT        PRIMARY KEY,
  job_id      UUID        NOT NULL REFERENCES public.public_scan_jobs(id) ON DELETE CASCADE,
  cached_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  /** Tied to public_scan_jobs.status so we can detect a stale cache entry pointing
   *  at a failed job and silently regenerate without serving the failure. */
  job_status  TEXT        NOT NULL DEFAULT 'queued'
);

CREATE INDEX IF NOT EXISTS zhangqian_scan_domain_cache_cached_idx
  ON public.zhangqian_scan_domain_cache(cached_at);

ALTER TABLE public.zhangqian_scan_domain_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full"
  ON public.zhangqian_scan_domain_cache FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.zhangqian_scan_domain_cache IS
  'Phase X.S3 H3 — 24h domain-keyed cache of recent public_scan_jobs ids. Hammering the same URL returns the existing job instead of re-running a $0.57 agent.';
