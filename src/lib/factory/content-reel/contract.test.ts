/**
 * Drift guard between the TypeScript contract and the migration that enforces it.
 *
 * Behaviour of the SQL itself is proven on a real Postgres by
 * scripts/content-reel-publish-db-check.sh (replay + probes + concurrency). This test
 * only guarantees the vocabulary PR-C will import cannot silently diverge from the
 * database: states, transition pairs, patch keys, followup keys, refusal codes and
 * timing floors are all read back out of the migration text.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  CONTENT_REEL_ACTIVE_STATES,
  CONTENT_REEL_BOOKKEEPING_COLUMNS,
  CONTENT_REEL_EVIDENCE_TIMESTAMP_COLUMNS,
  CONTENT_REEL_DUPLICATE_HASH_WINDOW_DAYS,
  CONTENT_REEL_FOLLOWUP_KEYS,
  CONTENT_REEL_GUARD_ERROR_CODES,
  CONTENT_REEL_PATCH_MARKER_KEYS,
  CONTENT_REEL_PATCH_VALUE_KEYS,
  CONTENT_REEL_RPC_REFUSAL_CODES,
  CONTENT_REEL_STATES,
  CONTENT_REEL_TIMING_MINUTES,
  CONTENT_REEL_TRANSITIONS,
  isContentReelTransitionAllowed,
} from './contract'

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260915140000_content_reel_publish_attempts.sql'),
  'utf8',
)

function between(start: string, end: string): string {
  const i = MIGRATION.indexOf(start)
  expect(i, `anchor not found: ${start}`).toBeGreaterThanOrEqual(0)
  const j = MIGRATION.indexOf(end, i + start.length)
  expect(j, `end anchor not found: ${end}`).toBeGreaterThan(i)
  return MIGRATION.slice(i, j)
}

const quoted = (text: string): string[] => Array.from(text.matchAll(/'([a-z_]+)'/g), (m) => m[1])

describe('content reel contract matches the migration', () => {
  it('state CHECK lists exactly the contract states', () => {
    const block = between('  state                            text NOT NULL CHECK (state IN (', ')),')
    expect(new Set(quoted(block))).toEqual(new Set(CONTENT_REEL_STATES))
  })

  it('partial unique index covers exactly the active states', () => {
    const block = between('CREATE UNIQUE INDEX content_reel_publish_attempts_one_active', ';')
    expect(new Set(quoted(block))).toEqual(new Set(CONTENT_REEL_ACTIVE_STATES))
  })

  it('transition table is identical to content_reel_transition_allowed()', () => {
    const block = between('SELECT (p_from, p_to) IN (', ');\n$fn$;')
    const pairs = Array.from(block.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g), (m) => `${m[1]}->${m[2]}`)
    expect(new Set(pairs)).toEqual(new Set(CONTENT_REEL_TRANSITIONS.map(([f, t]) => `${f}->${t}`)))
    expect(pairs).toHaveLength(CONTENT_REEL_TRANSITIONS.length)
  })

  it('terminal states have no way back to an active state except not_on_facebook -> published', () => {
    const terminal = ['cancelled', 'preflight_failed', 'not_on_facebook', 'draft_deleted', 'removed_externally'] as const
    for (const from of terminal) {
      for (const to of CONTENT_REEL_ACTIVE_STATES) {
        expect(isContentReelTransitionAllowed(from, to), `${from} -> ${to}`).toBe(false)
      }
    }
    expect(isContentReelTransitionAllowed('not_on_facebook', 'published')).toBe(true)
    expect(isContentReelTransitionAllowed('cancelled', 'authorized')).toBe(false)
  })

  it('patch whitelist in content_reel_transition equals value + marker keys', () => {
    const block = between("IF v_key NOT IN (", ') THEN')
    expect(new Set(quoted(block))).toEqual(
      new Set([...CONTENT_REEL_PATCH_VALUE_KEYS, ...CONTENT_REEL_PATCH_MARKER_KEYS]),
    )
  })

  it('followup keys equal content_reel_followup_patch whitelist', () => {
    const block = between('IF p_key IS NULL OR p_key NOT IN (', ') THEN')
    expect(new Set(quoted(block))).toEqual(new Set(CONTENT_REEL_FOLLOWUP_KEYS))
  })

  it('every refusal code returned by an RPC is in the contract, and vice versa', () => {
    const returned = new Set(
      Array.from(MIGRATION.matchAll(/'code', '([a-z_]+)'/g), (m) => m[1]),
    )
    const soft = between('v_soft constant text[] := ARRAY[', '];')
    for (const code of quoted(soft)) returned.add(code)
    expect(returned).toEqual(new Set(CONTENT_REEL_RPC_REFUSAL_CODES))
  })

  it('every guard error code raised by the migration is in the contract, and vice versa', () => {
    const raised = new Set(Array.from(MIGRATION.matchAll(/content_reel_guard:([a-z_]+)/g), (m) => m[1]))
    expect(raised).toEqual(new Set(CONTENT_REEL_GUARD_ERROR_CODES))
  })

  it('publish attempts column list snapshot (a new or renamed column must be a deliberate contract change)', () => {
    const block = between('CREATE TABLE public.content_reel_publish_attempts (', '\n);')
    const columns = block
      .split('\n')
      .slice(1)
      .map((line) => line.trim().match(/^([a-z_0-9]+)\s/)?.[1])
      .filter((c): c is string => Boolean(c))
    expect(columns).toEqual([
      'id', 'client_id', 'content_post_id', 'video_copy_id', 'render_job_id', 'mode_requested', 'state',
      'form_sha256', 'authorized_via', 'authorized_by_user_id', 'authorized_by_email', 'prepared_by',
      'authorization_record', 'video_sha256', 'page_id', 'video_id', 'video_state', 'permalink', 'published_at',
      'publish_confirmation', 'publish_confirmed_by_user_id', 'publish_verified_at', 'env_live_at_publish',
      'rules_live_at_publish', 'error_code', 'error_detail', 'alert_code', 'last_step_started_at',
      'video_deleted_at', 'absence_first_confirmed_at', 'trigger_event_ids', 'restart_seq',
      'first_comment_state', 'first_comment_verified_at', 'first_comment_verification_basis', 'followup',
      'provider_impact', 'created_at', 'updated_at', 'finished_at',
    ])
  })

  it('bookkeeping columns equal the guard fast path, and every evidence timestamp is DB-clock guarded', () => {
    const block = between("v_bookkeeping constant text[] := ARRAY[", '];')
    expect(new Set(quoted(block))).toEqual(new Set(CONTENT_REEL_BOOKKEEPING_COLUMNS))
    const guard = between('-- Evidence timestamps: database clock only.', "content_reel_guard:evidence_timestamp_db_clock_only")
    for (const col of CONTENT_REEL_EVIDENCE_TIMESTAMP_COLUMNS) {
      expect(guard, col).toContain(`NEW.${col} IS DISTINCT FROM OLD.${col}`)
    }
  })

  it('timing floors and duplicate window match the SQL intervals', () => {
    expect(MIGRATION).toContain(`interval '${CONTENT_REEL_TIMING_MINUTES.claimedWithoutVideo} minutes'`)
    expect(MIGRATION).toContain(`interval '${CONTENT_REEL_TIMING_MINUTES.lastWriteBeforeAbsence} minutes'`)
    expect(MIGRATION).toContain(`interval '${CONTENT_REEL_TIMING_MINUTES.absenceConfirmationGap} minutes'`)
    expect(MIGRATION).toContain(`interval '${CONTENT_REEL_DUPLICATE_HASH_WINDOW_DAYS} days'`)
    expect(CONTENT_REEL_TIMING_MINUTES.lastWriteBeforeAbsence).toBeGreaterThan(1 + 15 + 1)
  })

  it('every SECURITY DEFINER function pins search_path and is granted to service_role only', () => {
    const definers = Array.from(
      MIGRATION.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-z_]+)\([^)]*\)[\s\S]*?LANGUAGE plpgsql SECURITY DEFINER\nSET search_path = pg_catalog, pg_temp/g),
      (m) => m[1],
    )
    expect(definers).toHaveLength(10)
    for (const fn of definers) {
      expect(MIGRATION).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`))
      expect(MIGRATION).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`))
    }
    const definerCount = (MIGRATION.match(/SECURITY DEFINER\n/g) ?? []).length
    expect(definerCount).toBe(definers.length)
  })

  it('every policy on the new tables is TO service_role', () => {
    const policies = Array.from(MIGRATION.matchAll(/CREATE POLICY [^\n]+\n\s+FOR ALL ([^\n]+)/g), (m) => m[1])
    expect(policies).toHaveLength(3)
    for (const p of policies) expect(p).toBe('TO service_role USING (true) WITH CHECK (true);')
  })
})
