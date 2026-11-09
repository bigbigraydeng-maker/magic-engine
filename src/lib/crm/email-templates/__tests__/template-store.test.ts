import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  appendTemplateVersion,
  checkTemplateSendable,
  getCurrentTemplate,
  getTemplateVersion,
  listCurrentTemplates,
  listTemplateHistory,
  validateNewTemplateInput,
} from '@/lib/crm/email-templates/template-store'
import type { EmailTemplateVersion, NewTemplateVersionInput } from '@/lib/crm/email-templates/types'
import { createFakeDb } from '@/lib/crm/email-templates/__tests__/fake-db'

const CLIENT_A = 'client-a'
const CLIENT_B = 'client-b'

function baseInput(overrides: Partial<NewTemplateVersionInput> = {}): NewTemplateVersionInput {
  return {
    clientId: CLIENT_A,
    templateKey: 'welcome-email',
    baseVersion: null,
    name: '欢迎邮件',
    subject: '欢迎加入',
    body: '你好，欢迎加入我们的旅程。',
    factSource: 'none',
    pickMode: 'none',
    pickFilter: {},
    status: 'active',
    changeNote: null,
    createdBy: 'staff@example.com',
    ...overrides,
  }
}

function makeDb() {
  return createFakeDb({ unique: { crm_email_templates: [['client_id', 'template_key', 'version']] } })
}

function expectOk<T>(result: { ok: true; value: T } | { ok: false; reason: string; message: string }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}: ${result.message}`)
  return result.value
}

describe('template-store', () => {
  it('creates a new key at version 1 with client_id and client_id filters on selects', async () => {
    const { db, tables, calls } = makeDb()
    const result = await appendTemplateVersion(db, baseInput())
    const value = expectOk(result)
    expect(value.version).toBe(1)
    expect(value.clientId).toBe(CLIENT_A)
    expect(tables.crm_email_templates).toHaveLength(1)
    expect(tables.crm_email_templates[0].client_id).toBe(CLIENT_A)
    const selectCalls = calls.filter((c) => c.op === 'select')
    expect(selectCalls.length).toBeGreaterThan(0)
    for (const call of selectCalls) {
      expect(call.filters.some((f) => f.kind === 'eq' && f.col === 'client_id' && f.value === CLIENT_A)).toBe(true)
    }
  })

  it('edits an existing key to version 2 and exposes history newest first', async () => {
    const { db } = makeDb()
    expectOk(await appendTemplateVersion(db, baseInput()))
    const v2 = expectOk(await appendTemplateVersion(db, baseInput({ baseVersion: 1, subject: '更新主题' })))
    expect(v2.version).toBe(2)
    const current = await getCurrentTemplate(db, CLIENT_A, 'welcome-email')
    expect(current?.version).toBe(2)
    const history = await listTemplateHistory(db, CLIENT_A, 'welcome-email')
    expect(history.map((h) => h.version)).toEqual([2, 1])
  })

  it('rejects a stale edit with conflict and stores nothing new', async () => {
    const { db, tables } = makeDb()
    expectOk(await appendTemplateVersion(db, baseInput()))
    expectOk(await appendTemplateVersion(db, baseInput({ baseVersion: 1 })))
    const stale = await appendTemplateVersion(db, baseInput({ baseVersion: 1 }))
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('conflict')
    expect(tables.crm_email_templates).toHaveLength(2)
  })

  it('rejects creating a key that already exists', async () => {
    const { db } = makeDb()
    expectOk(await appendTemplateVersion(db, baseInput()))
    const dup = await appendTemplateVersion(db, baseInput())
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.reason).toBe('conflict')
  })

  it('maps a unique-violation race to conflict', async () => {
    const stub = {
      from: () => {
        const builder: Record<string, unknown> = {}
        builder.select = () => builder
        builder.eq = () => builder
        builder.order = () => builder
        builder.limit = () => builder
        builder.insert = () => builder
        builder.single = () => Promise.resolve({ data: null, error: { code: '23505', message: 'dup' } })
        builder.maybeSingle = () => Promise.resolve({ data: null, error: null })
        builder.then = (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(onFulfilled)
        return builder
      },
    }
    const db = stub as unknown as SupabaseClient
    const result = await appendTemplateVersion(db, baseInput())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('conflict')
  })

  it('isolates clients from each other', async () => {
    const { db } = makeDb()
    expectOk(await appendTemplateVersion(db, baseInput()))
    expect(await listCurrentTemplates(db, CLIENT_B)).toEqual([])
    expect(await getCurrentTemplate(db, CLIENT_B, 'welcome-email')).toBeNull()
    expect(await getTemplateVersion(db, CLIENT_B, 'welcome-email', 1)).toBeNull()
    expect(await listTemplateHistory(db, CLIENT_B, 'welcome-email')).toEqual([])
    const own = expectOk(await appendTemplateVersion(db, baseInput({ clientId: CLIENT_B })))
    expect(own.version).toBe(1)
    expect(own.clientId).toBe(CLIENT_B)
  })

  it('lists only the latest version per key sorted by name, including disabled', async () => {
    const { db } = makeDb()
    expectOk(await appendTemplateVersion(db, baseInput({ templateKey: 'zeta-key', name: 'Zeta' })))
    expectOk(await appendTemplateVersion(db, baseInput({ templateKey: 'alpha-key', name: 'Alpha' })))
    expectOk(await appendTemplateVersion(db, baseInput({ templateKey: 'alpha-key', name: 'Alpha', baseVersion: 1, status: 'disabled' })))
    const list = await listCurrentTemplates(db, CLIENT_A)
    expect(list.map((t) => t.templateKey)).toEqual(['alpha-key', 'zeta-key'])
    expect(list[0].version).toBe(2)
    expect(list[0].status).toBe('disabled')
  })

  it.each([
    ['bad key', { templateKey: 'Bad Key' }],
    ['blank subject', { subject: '   ' }],
    ['body too long', { body: 'x'.repeat(10001) }],
    ['change note too long', { changeNote: 'x'.repeat(301) }],
    ['pickMode one with factSource none', { pickMode: 'one' as const }],
    ['factSource published_tours with pickMode none', { factSource: 'published_tours' as const }],
    ['departureMonths 13', { pickFilter: { departureMonths: [13] } }],
    ['createdBy too short', { createdBy: 'x' }],
    ['baseVersion 0', { baseVersion: 0 }],
  ])('rejects invalid input: %s', async (_label, overrides) => {
    const { db, tables } = makeDb()
    const result = await appendTemplateVersion(db, baseInput(overrides as Partial<NewTemplateVersionInput>))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid')
    expect(tables.crm_email_templates ?? []).toHaveLength(0)
  })

  it('validates input directly', () => {
    expect(validateNewTemplateInput(baseInput())).toBeNull()
    expect(validateNewTemplateInput(baseInput({ templateKey: 'Bad Key' }))).not.toBeNull()
  })

  it('checks sendability with disabled and outdated rules', () => {
    const disabledV2: EmailTemplateVersion = {
      id: 'x',
      clientId: CLIENT_A,
      templateKey: 'k',
      version: 2,
      name: 'n',
      subject: 's',
      body: 'b',
      factSource: 'none',
      pickMode: 'none',
      pickFilter: {},
      status: 'disabled',
      changeNote: null,
      createdBy: 'staff@example.com',
      createdAt: '2024-01-01T00:00:00.000Z',
    }
    expect(checkTemplateSendable(disabledV2, 1)).toEqual({ ok: false, reason: 'template_unavailable' })
    expect(checkTemplateSendable(disabledV2, 2)).toEqual({ ok: false, reason: 'template_unavailable' })
    const activeV3: EmailTemplateVersion = { ...disabledV2, version: 3, status: 'active' }
    expect(checkTemplateSendable(activeV3, 2)).toEqual({ ok: false, reason: 'template_outdated' })
    expect(checkTemplateSendable(activeV3, 3)).toEqual({ ok: true })
    expect(checkTemplateSendable(null, 1)).toEqual({ ok: false, reason: 'template_unavailable' })
  })

  it('surfaces database failures', async () => {
    const { db } = createFakeDb({ failTable: 'crm_email_templates' })
    await expect(listCurrentTemplates(db, CLIENT_A)).rejects.toThrow('crm_email_templates:')
    const result = await appendTemplateVersion(db, baseInput())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('error')
  })

  it('rejects unreadable rows', async () => {
    const { db } = createFakeDb({
      seed: {
        crm_email_templates: [
          {
            id: 'r1',
            client_id: CLIENT_A,
            template_key: 'welcome-email',
            version: 1,
            name: 'n',
            subject: 's',
            fact_source: 'none',
            pick_mode: 'none',
            pick_filter: {},
            status: 'active',
            change_note: null,
            created_by: 'staff@example.com',
            created_at: '2024-01-01T00:00:00.000Z',
          },
        ],
      },
    })
    await expect(listCurrentTemplates(db, CLIENT_A)).rejects.toThrow('unreadable row')
  })

  it('disabling is a new version', async () => {
    const { db } = makeDb()
    expectOk(await appendTemplateVersion(db, baseInput()))
    expectOk(await appendTemplateVersion(db, baseInput({ baseVersion: 1, status: 'disabled' })))
    const current = await getCurrentTemplate(db, CLIENT_A, 'welcome-email')
    expect(current?.status).toBe('disabled')
    expect(current?.version).toBe(2)
  })
})
