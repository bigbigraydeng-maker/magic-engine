import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ADS_AGENT_CHECKLIST } from '../checklists/ads-agent'
import { checklistHash } from '../checklist-hash'

const admin = vi.hoisted(() => ({ result: { ok: false as boolean, status: 401 as number, user: { email: 'pm@example.com' } } }))
vi.mock('@/lib/auth/require-admin', () => ({
  requireGlobalAdmin: async () => (admin.result.ok ? { ok: true, user: admin.result.user } : { ok: false, status: admin.result.status, error: 'x' }),
}))

import { authenticate, signerEmails } from '../auth'

const req = (headers: Record<string, string> = {}) => new Request('http://localhost/x', { headers })
const env = { LAUNCH_SIGNOFF_EXECUTOR_KEY: 'exec-secret-1', LAUNCH_SIGNOFF_REVIEWER_KEY: 'review-secret-2', LAUNCH_SIGNOFF_SIGNERS: 'PM@Example.com, other@example.com' } as unknown as NodeJS.ProcessEnv

beforeEach(() => { admin.result = { ok: false, status: 401, user: { email: 'pm@example.com' } } })

describe('authenticate', () => {
  it('the key decides the role; the caller cannot claim one', async () => {
    expect(await authenticate(req({ 'x-launch-signoff-key': 'exec-secret-1' }), env)).toMatchObject({ role: 'executor', isHuman: false, isSigner: false })
    expect(await authenticate(req({ 'x-launch-signoff-key': 'review-secret-2' }), env)).toMatchObject({ role: 'reviewer', isHuman: false, isSigner: false })
    await expect(authenticate(req({ 'x-launch-signoff-key': 'nope' }), env)).rejects.toMatchObject({ status: 401 })
    // a role header is simply ignored
    expect(await authenticate(req({ 'x-launch-signoff-key': 'exec-secret-1', 'x-launch-signoff-role': 'reviewer' }), env)).toMatchObject({ role: 'executor' })
  })

  it('unset keys never match (an empty header cannot authenticate)', async () => {
    await expect(authenticate(req({ 'x-launch-signoff-key': 'anything' }), {} as NodeJS.ProcessEnv)).rejects.toMatchObject({ status: 401 })
  })

  it('a human session is a signer only when its email is on the whitelist (case-insensitive); empty whitelist = nobody', async () => {
    admin.result = { ok: true, status: 200, user: { email: 'pm@example.com' } }
    expect(await authenticate(req(), env)).toMatchObject({ role: 'human', isHuman: true, isSigner: true, id: 'pm@example.com' })
    admin.result = { ok: true, status: 200, user: { email: 'stranger@example.com' } }
    expect(await authenticate(req(), env)).toMatchObject({ isHuman: true, isSigner: false })
    admin.result = { ok: true, status: 200, user: { email: 'pm@example.com' } }
    expect(await authenticate(req(), {} as NodeJS.ProcessEnv)).toMatchObject({ isSigner: false })
    expect(signerEmails(env)).toEqual(['pm@example.com', 'other@example.com'])
  })

  it('a cookie-session write from another site is refused; same-origin passes; keys are not subject to it', async () => {
    admin.result = { ok: true, status: 200, user: { email: 'pm@example.com' } }
    const post = (headers: Record<string, string>) => new Request('http://localhost/x', { method: 'POST', headers })
    await expect(authenticate(post({ 'sec-fetch-site': 'cross-site' }), env)).rejects.toMatchObject({ status: 403, code: 'cross_site' })
    await expect(authenticate(post({ origin: 'https://evil.example', host: 'app.example.com' }), env)).rejects.toMatchObject({ code: 'cross_site' })
    expect(await authenticate(post({ 'sec-fetch-site': 'same-origin' }), env)).toMatchObject({ isHuman: true })
    expect(await authenticate(post({ origin: 'https://app.example.com', host: 'app.example.com' }), env)).toMatchObject({ isHuman: true })
    expect(await authenticate(post({ 'x-launch-signoff-key': 'exec-secret-1', 'x-launch-signoff-window': ' 119 !x' }), env)).toMatchObject({ id: 'key:executor(119x)', role: 'executor' })
  })

  it('no login => 401/403, never an anonymous pass', async () => {
    await expect(authenticate(req(), env)).rejects.toMatchObject({ status: 401 })
    admin.result = { ok: false, status: 403, user: { email: 'x' } }
    await expect(authenticate(req(), env)).rejects.toMatchObject({ status: 403 })
  })
})

describe('checklist definition', () => {
  it('has the same T-keys as the human-readable checklist document', () => {
    const doc = readFileSync(join(process.cwd(), ADS_AGENT_CHECKLIST.docPath), 'utf8')
    const docKeys = Array.from(doc.matchAll(/^\| (T\d+) \|/gm)).map((m) => m[1])
    expect(ADS_AGENT_CHECKLIST.items.map((i) => i.key)).toEqual(docKeys)
  })

  it('the fingerprint changes when any criterion text changes', () => {
    const base = checklistHash(ADS_AGENT_CHECKLIST)
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    const first = ADS_AGENT_CHECKLIST.items[0]
    if (!first) throw new Error('no items')
    const changed = { ...ADS_AGENT_CHECKLIST, items: [{ ...first, passCriteria: `${first.passCriteria}。` }, ...ADS_AGENT_CHECKLIST.items.slice(1)] }
    expect(checklistHash(changed)).not.toBe(base)
  })
})

describe('migration', () => {
  const dir = join(process.cwd(), 'supabase/migrations')
  const file = readdirSync(dir).find((n) => n.endsWith('_launch_signoff_events.sql'))
  const sql = file ? readFileSync(join(dir, file), 'utf8') : ''

  it('exists and follows the service-role-only RLS template', () => {
    expect(file).toBeDefined()
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/FOR ALL TO service_role\s+USING \(true\)/)
    // no policy may be created without TO service_role
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) ?? []
    expect(policies.length).toBeGreaterThan(0)
    for (const p of policies) expect(p).toContain('TO service_role')
  })

  it('is append-only: update/delete/truncate are blocked and revoked', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE')
    expect(sql).toContain('BEFORE TRUNCATE')
    expect(sql).toMatch(/REVOKE UPDATE, DELETE, TRUNCATE ON public\.launch_signoff_events FROM[^;]*service_role/)
  })

  it('only creates the one table and never touches anything else', () => {
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1)
    expect(sql).not.toMatch(/ALTER TABLE (?!public\.launch_signoff_events)/)
    expect(sql).not.toMatch(/\b(INSERT INTO|DROP TABLE)\b/)
  })
})
