/**
 * Rollout-order safety for the flywheel_outcomes identity change — Issue #859.
 *
 * The schema change and the code change cannot ship together: the writers on
 * main do not write `evaluator_key`, and the new writers cannot upsert until the
 * UNIQUE constraint exists. That leaves exactly one safe order:
 *
 *     [1] expand migration  →  [2] deploy new writers  →  [3] contract migration
 *                                                            (separate follow-up
 *                                                            PR — NOT here)
 *
 * These tests hold that order in place. Two kinds of evidence appear here and
 * they prove different things — the distinction is deliberate:
 *
 *   · behavioural — the old and new writers are run against a fake that models
 *     each schema state's constraints, so "old code still works after step [1]"
 *     is executed, not asserted;
 *   · structural  — the migration SQL is read and inspected. This checks the
 *     files say what the rollout requires (no DELETE, no premature NOT NULL,
 *     guards before the operations they guard). It does NOT execute Postgres;
 *     there is no local database in this suite and none was added for it.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { FakeOutcomesDb, NATURAL_KEY_COLUMNS, type OutcomeSchemaState } from './fake-outcomes-db'
import { OUTCOME_CONFLICT_TARGET, OUTCOME_EVALUATOR } from '../outcome-identity'

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations')
const EXPAND_SQL = readFileSync(
  path.join(MIGRATIONS, '20260808000001_flywheel_outcomes_identity_expand.sql'),
  'utf8',
)

// ── The writers as they exist on main, reproduced statement for statement ────
//
// Copied from origin/main src/lib/flywheel/attribution/{job,gsc-bridge}.ts.
// Note what they do NOT do: neither passes `evaluator_key`. That is the whole
// reason the expand migration must leave the column nullable.

async function legacyJobWrite(
  db: FakeOutcomesDb,
  row: { action_id: string; client_id: string; metric_key: string; window_days: number },
): Promise<{ error: { message: string } | null }> {
  const del = await db.from('flywheel_outcomes').delete().eq('action_id', row.action_id)
  if (del.error) return { error: del.error }

  return db.from('flywheel_outcomes').insert({
    action_id: row.action_id,
    client_id: row.client_id,
    metric_key: row.metric_key,
    baseline: 100,
    after_value: 140,
    delta: 40,
    delta_pct: 40,
    confidence: 0.95,
    verdict: 'confirmed',
    window_days: row.window_days,
    computed_at: new Date().toISOString(),
  })
}

async function legacyGscWrite(
  db: FakeOutcomesDb,
  actionId: string,
  clientId: string,
  windowDays = 28,
): Promise<{ error: { message: string } | null }> {
  const metricKeys = ['seo.gsc.clicks', 'seo.gsc.impressions', 'seo.gsc.avg_position']

  await db.from('flywheel_outcomes').delete().eq('action_id', actionId).in('metric_key', metricKeys)

  return db.from('flywheel_outcomes').insert(
    metricKeys.map(metric_key => ({
      action_id: actionId,
      client_id: clientId,
      metric_key,
      baseline: 100,
      after_value: 150,
      delta: 50,
      delta_pct: 50,
      confidence: 0.95,
      verdict: 'confirmed',
      window_days: windowDays,
      computed_at: new Date().toISOString(),
    })),
  )
}

/** The new writers' shape: declares evaluator_key, upserts on the natural key. */
async function newWriterUpsert(
  db: FakeOutcomesDb,
  row: {
    action_id: string
    client_id: string
    metric_key: string
    window_days: number
    evaluator_key?: string
    verdict?: string
  },
): Promise<{ error: { message: string } | null }> {
  return db.from('flywheel_outcomes').upsert(
    {
      action_id: row.action_id,
      client_id: row.client_id,
      metric_key: row.metric_key,
      window_days: row.window_days,
      verdict: row.verdict ?? 'confirmed',
      evaluator_key: row.evaluator_key ?? OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
      computed_at: new Date().toISOString(),
    },
    { onConflict: OUTCOME_CONFLICT_TARGET },
  )
}

function dbAt(schema: OutcomeSchemaState): FakeOutcomesDb {
  return new FakeOutcomesDb({ schema })
}

// ── Criterion 1 + 5: old writers survive the expand migration ────────────────

describe('[1] expand — the writers on main keep working', () => {
  let db: FakeOutcomesDb

  beforeEach(() => {
    db = dbAt('post_expand')
  })

  it('the legacy flywheel_metrics writer can still insert without evaluator_key', async () => {
    const { error } = await legacyJobWrite(db, {
      action_id: 'a1',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
    })

    expect(error).toBeNull()
    expect(db.outcomes()).toHaveLength(1)
    expect(db.outcomes()[0].evaluator_key).toBeUndefined()
  })

  it('the legacy GSC writer can still insert its three rows', async () => {
    const { error } = await legacyGscWrite(db, 'a1', 'c1')

    expect(error).toBeNull()
    expect(db.outcomes()).toHaveLength(3)
  })

  it('a NULL evaluator_key is allowed and observable during the window', async () => {
    await legacyGscWrite(db, 'a1', 'c1')
    await newWriterUpsert(db, {
      action_id: 'a2',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
      evaluator_key: OUTCOME_EVALUATOR.FLYWHEEL_METRICS,
    })

    const nullCount = db.outcomes().filter(r => r.evaluator_key == null).length
    const declared = db.outcomes().filter(r => r.evaluator_key != null).length

    // Mixed old/new rows coexist — this is the state the contract guard reads.
    expect(nullCount).toBe(3)
    expect(declared).toBe(1)
  })

  it('the legacy writer repeated many times still cannot break the UNIQUE constraint', async () => {
    // DELETE-then-INSERT can never leave two rows on one key, which is why the
    // UNIQUE is safe to add before the code ships.
    for (let i = 0; i < 5; i++) await legacyGscWrite(db, 'a1', 'c1')
    expect(db.outcomes()).toHaveLength(3)
  })

  it('the generated outcome_key is filled in for rows the legacy writer inserts', async () => {
    await legacyJobWrite(db, {
      action_id: 'a1',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
    })
    expect(db.outcomes()[0].outcome_key).toBe('a1:seo.domain.organic_traffic:14')
  })
})

// ── Criterion 4: the new writers need the constraint to already exist ────────

describe('[2] deploy — the new writers require the expand migration first', () => {
  it('upserting before the UNIQUE exists fails the way Postgres fails', async () => {
    const db = dbAt('pre_expand')

    const { error } = await newWriterUpsert(db, {
      action_id: 'a1',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
    })

    expect(error?.message).toContain('no unique or exclusion constraint')
    expect(db.outcomes()).toHaveLength(0)
  })

  it('the same upsert succeeds once the expand migration has landed', async () => {
    const db = dbAt('post_expand')

    const { error } = await newWriterUpsert(db, {
      action_id: 'a1',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
    })

    expect(error).toBeNull()
    expect(db.outcomes()).toHaveLength(1)
    expect(db.outcomes()[0].evaluator_key).toBe(OUTCOME_EVALUATOR.FLYWHEEL_METRICS)
  })

  it('an unknown evaluator label is rejected by the CHECK even while nullable', async () => {
    const db = dbAt('post_expand')

    const { error } = await newWriterUpsert(db, {
      action_id: 'a1',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
      evaluator_key: 'some_new_pipeline',
    })

    expect(error?.message).toContain('flywheel_outcomes_evaluator_key_check')
  })
})

// ── Why the contract must come last — and therefore cannot ship here ────────
//
// `post_contract` models the FUTURE contract migration (SET NOT NULL + narrowed
// CHECKs). That migration lives in a separate follow-up PR, gated on
// `SELECT count(*) FROM flywheel_outcomes WHERE evaluator_key IS NULL` = 0
// after the new writers are verified live. These behavioural tests are the
// evidence for why: the old writers break the moment the column tightens.

describe('[3] contract (follow-up PR) — only safe once every writer declares itself', () => {
  it('the legacy writer breaks under the contracted schema (so contract must come after deploy)', async () => {
    const db = dbAt('post_contract')

    const { error } = await legacyJobWrite(db, {
      action_id: 'a1',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
    })

    expect(error?.message).toContain('violates not-null constraint')
  })

  it('the new writer works under the contracted schema', async () => {
    const db = dbAt('post_contract')

    const { error } = await newWriterUpsert(db, {
      action_id: 'a1',
      client_id: 'c1',
      metric_key: 'seo.domain.organic_traffic',
      window_days: 14,
    })

    expect(error).toBeNull()
    expect(db.outcomes()).toHaveLength(1)
  })
})

// ── Structural: what the migration files must and must not contain ──────────

describe('expand migration SQL', () => {
  it('never deletes an outcome row', () => {
    expect(EXPAND_SQL).not.toMatch(/\bDELETE\s+FROM\b/i)
  })

  it('aborts on duplicates instead of collapsing them', () => {
    expect(EXPAND_SQL).toMatch(/RAISE EXCEPTION/)
    expect(EXPAND_SQL).not.toMatch(/PARTITION BY action_id, metric_key, window_days/)
  })

  it('checks for duplicates before adding the UNIQUE constraint', () => {
    const guardAt = EXPAND_SQL.indexOf('HAVING count(*) > 1')
    const constraintAt = EXPAND_SQL.indexOf('ADD CONSTRAINT flywheel_outcomes_natural_key')

    expect(guardAt).toBeGreaterThan(-1)
    expect(constraintAt).toBeGreaterThan(guardAt)
  })

  it('leaves evaluator_key nullable — no NOT NULL, no DEFAULT', () => {
    // Anchored on the operational statement, not the bare phrase — the header
    // prose legitimately *talks about* the follow-up contract tightening.
    expect(EXPAND_SQL).not.toMatch(/ALTER COLUMN\s+evaluator_key\s+SET NOT NULL/i)
    expect(EXPAND_SQL).not.toMatch(/ADD COLUMN[^;]*evaluator_key[^;]*DEFAULT/i)
  })

  it('writes a CHECK that admits NULL', () => {
    expect(EXPAND_SQL).toMatch(/CHECK \(evaluator_key IS NULL OR evaluator_key IN \(/)
  })

  it('adds the UNIQUE constraint and the generated outcome_key', () => {
    expect(EXPAND_SQL).toMatch(/ADD CONSTRAINT flywheel_outcomes_natural_key\s+UNIQUE/)
    expect(EXPAND_SQL).toMatch(/GENERATED ALWAYS AS \(/)
  })

  it('labels the backfill as inference rather than proven provenance', () => {
    expect(EXPAND_SQL).toMatch(/BEST-EFFORT HISTORICAL INFERENCE/)
  })

  it('OUTCOME_CONFLICT_TARGET lists exactly the UNIQUE constraint columns', () => {
    const match = EXPAND_SQL.match(
      /ADD CONSTRAINT flywheel_outcomes_natural_key\s+UNIQUE \(([^)]+)\)/,
    )
    expect(match).not.toBeNull()

    const columns = match![1].split(',').map(c => c.trim())
    expect(columns).toEqual([...NATURAL_KEY_COLUMNS])
    expect(OUTCOME_CONFLICT_TARGET.split(',').map(c => c.trim())).toEqual(columns)
  })
})

// ── The behavioural model is only worth anything if it tracks the SQL ───────
//
// `post_contract` has no SQL file to track in this branch — it models the
// follow-up contract PR. That PR must add the matching model↔SQL test when it
// brings the file.

describe('the schema model matches the migrations it claims to model', () => {
  it('post_expand requires evaluator_key exactly when the expand migration tightens it', () => {
    expect(dbAt('post_expand').evaluatorKeyIsRequired()).toBe(
      /ALTER COLUMN\s+evaluator_key\s+SET NOT NULL/i.test(EXPAND_SQL),
    )
  })

  it('post_expand has the natural key exactly when the expand migration adds it', () => {
    expect(dbAt('post_expand').hasNaturalKeyConstraint()).toBe(
      /ADD CONSTRAINT flywheel_outcomes_natural_key\s+UNIQUE/.test(EXPAND_SQL),
    )
  })
})

// ── Criterion 7: the contract migration is deliberately absent from this PR ──
//
// Review (PR #862, Codex P1): the contract's NULL-count guard measures DATA
// state, not DEPLOY state. The expand backfill zeroes that count, so a contract
// file sitting in the same branch passes its own guard when both are applied in
// one batch — SET NOT NULL lands while the old writers still run, and every
// attribution write fails from then on. "In the repo but remember not to apply
// it" is a convention; absence is enforcement.
//
// The follow-up contract PR must consciously delete this block and bring the
// null-guard tests (guard aborts when null_count > 0, tightens when 0) in its
// place — flipping these assertions is the moment the deploy gate is
// acknowledged, not an incidental test failure.

describe('the contract migration is deliberately absent from this PR', () => {
  const sqlFiles = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql'))

  it('no migration file names itself the flywheel_outcomes contract', () => {
    expect(sqlFiles.filter(f => /flywheel_outcomes.*contract/.test(f))).toEqual([])
  })

  it('no migration tightens flywheel_outcomes.evaluator_key to NOT NULL', () => {
    // Quoted-identifier form included; dynamic SQL (EXECUTE format(...)) is
    // out of reach for a text scan — the filename test above and the follow-up
    // PR's conscious flip of this block cover the realistic cases.
    const offenders = sqlFiles.filter(f => {
      const sql = readFileSync(path.join(MIGRATIONS, f), 'utf8')
      return /flywheel_outcomes/.test(sql)
        && /ALTER COLUMN\s+"?evaluator_key"?\s+SET\s+NOT\s+NULL/i.test(sql)
    })
    expect(offenders).toEqual([])
  })
})
