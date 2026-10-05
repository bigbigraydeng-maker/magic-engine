// Tools Lab — a combined monthly ceiling on Magic Engine's OWN AI spend across every free/sponsored
// tool (never a client's own connected ad account or Meta ad budget — that money isn't ours to cap).
//
// This is a backstop, not the primary gate. Two caps already exist and stay exactly as they are,
// unchanged, fully authoritative:
//   - site-check's own whole-site cap: LIMITS.checkPerMonth = 1500 calls/month (~US$13.50 typical).
//   - ads-check's own PER-CLIENT sponsored cap: meta_ads_ai_pilot_entitlements.sponsored_monthly_cap_usd,
//     enforced per client, up to US$25/client/month (see supabase/migrations/20260921060122_meta_ads_ai_hosted_analysis.sql).
// What neither cap covers: nothing limits how many CLIENTS can hold a sponsored entitlement at once —
// sponsored spend is capped per client but unbounded in aggregate (today: 1 client, cap $1.25/month;
// nothing stops that becoming 50 clients at up to $25 each). This bucket is the aggregate backstop for
// exactly that gap. Both consumers below share this ONE bucket (same bucket type, key 'all', UTC
// calendar-month window) via `consumeQuota` — the same atomic, fail-closed primitive every Tools Lab
// quota already goes through (src/lib/zhangqian/rate-limiter.ts).
//
// Why a call COUNT, not a live dollar sum: the only atomic primitive available increments a count by
// exactly 1 per call — it has no arbitrary-amount increment. A real-time dollar-summed cap would need
// either a new DB aggregate function (a migration — CLAUDE.md classifies any migration as A-level, out
// of scope for this internal-refactor PR) or an expensive live-sum query on every request. A
// count-based backstop, sized conservatively below, is the honest choice available without either.
//
// Cap derivation (see the PR body / ledger card for the numbers this was checked against):
//   1500 (site-check's own full monthly allowance — never squeezed by this backstop) + 500 headroom for
//   ads-check sponsored calls combined across every sponsored client = 2000/month. Worst case: 500
//   sponsored calls at the DB's own per-client reserve (~US$0.12–0.25/call) ≈ US$60–125/month, on top of
//   site-check's own ~US$13.50–27 — a real, stated ceiling that did not exist before this PR.
//
// #2128 (locking two other, unrelated, unauthenticated paid endpoints — /api/diagnose and
// /api/public-scan/keyword-gap) is NOT covered by this bucket. Do not say "every paid endpoint is
// capped" until that PR also merges.

export const TOOLS_AI_CALLS_MONTHLY_BUCKET = 'tools_ai_calls_month'
export const TOOLS_AI_CALLS_MONTHLY_CAP = 2000
