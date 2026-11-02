import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SQL = readFileSync(
  'supabase/migrations/20261102180000_social_verification_verdicts.sql',
  'utf8',
)

function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--')
      return idx === -1 ? line : line.slice(0, idx)
    })
    .join('\n')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

const CLEAN = stripComments(SQL)

describe('social verification verdict migration', () => {
  it('creates the verdict table and the story idempotency index', () => {
    expect(CLEAN).toContain('create table public.social_verification_verdicts')
    expect(CLEAN.match(/create table/g)).toHaveLength(1)
    expect(CLEAN).toContain('create unique index svv_request_uniq')
    expect(CLEAN).toContain('create unique index svv_identity_uniq')
    expect(CLEAN).toContain('flywheel_actions_social_publish_story_idempotency')
    expect(CLEAN).toContain("action_type = 'social.publish_story'")
    expect(CLEAN).toContain("payload ->> 'idempotency_key' is not null")
  })

  it('counts story duplicates before creating the unique index and does not delete rows', () => {
    const checkAt = CLEAN.indexOf('duplicate_groups')
    const indexAt = CLEAN.indexOf('flywheel_actions_social_publish_story_idempotency')
    expect(checkAt).toBeGreaterThan(0)
    expect(indexAt).toBeGreaterThan(checkAt)
    expect(CLEAN).toContain('no rows were deleted or updated')
    expect(CLEAN).not.toMatch(/delete\s+from\s+(public\.)?flywheel_actions/)
    expect(CLEAN).not.toMatch(/update\s+(public\.)?flywheel_actions/)
    expect(CLEAN).not.toMatch(/delete\s+from\s+(public\.)?social_verification_verdicts/)
  })

  it('keeps service_role-only RLS and an append-only trigger', () => {
    expect(CLEAN).toContain('enable row level security')
    expect(CLEAN).toContain('for all to service_role using (true) with check (true)')
    expect(CLEAN).toContain('revoke all on public.social_verification_verdicts from anon, authenticated')
    expect(CLEAN).not.toMatch(/\bto (public|anon|authenticated)\b/)
    expect(CLEAN).toContain('social_verification_verdicts is append-only')
    expect(CLEAN).toContain('before update or delete')
    expect(CLEAN).toContain('before truncate')
    expect(CLEAN).toContain('on delete restrict')
    expect(CLEAN).not.toContain('security definer')
    expect(CLEAN).toContain("check (platform in ('facebook','instagram'))")
  })

  it('does not touch publish switches', () => {
    expect(SQL).not.toMatch(/FACTORY_PUBLISH_LIVE/)
    expect(SQL).not.toMatch(/graph\.facebook/)
  })
})
