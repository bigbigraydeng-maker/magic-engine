import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260905123025_fix_post_measurement_search_path.sql',
)
const SQL = readFileSync(MIGRATION, 'utf8')

describe('post measurement SECURITY DEFINER search_path migration', () => {
  it('pins the exact function signature to pg_catalog, pg_temp', () => {
    expect(SQL).toMatch(
      /ALTER\s+FUNCTION\s+public\.record_post_measurement_snapshot\s*\(\s*uuid\s*,\s*uuid\s*,\s*text\s*,\s*text\s*,\s*text\s*,\s*integer\s*,\s*timestamptz\s*,\s*timestamptz\s*,\s*text\s*,\s*jsonb\s*,\s*jsonb\s*,\s*text\s*,\s*text\s*,\s*integer\s*,\s*integer\s*\)\s*SET\s+search_path\s*=\s*pg_catalog\s*,\s*pg_temp\s*;/i,
    )
  })

  it('does not widen the patch into function body, permissions, or data changes', () => {
    expect(SQL).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i)
    expect(SQL).not.toMatch(/\b(?:GRANT|REVOKE)\b/i)
    expect(SQL).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })
})
