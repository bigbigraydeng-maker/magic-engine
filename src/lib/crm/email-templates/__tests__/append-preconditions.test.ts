import { describe, expect, it } from 'vitest'
import { appendTemplateVersion } from '@/lib/crm/email-templates/template-store'
import { appendEmailSettings } from '@/lib/crm/email-templates/settings-store'
import { serialiseEmailSettings } from '@/lib/crm/email-templates/settings'
import type { EmailSettings, NewTemplateVersionInput } from '@/lib/crm/email-templates/types'
import { createFakeDb } from '@/lib/crm/email-templates/__tests__/fake-db'

// No `unique` option on purpose: the application check must hold even if the database constraint did not exist.

function templateRow(version: number): Record<string, unknown> {
  return {
    id: `id-${version}`,
    client_id: 'client-a',
    template_key: 'welcome-note',
    version,
    name: 'Note',
    subject: 'Subject',
    body: 'Body',
    fact_source: 'none',
    pick_mode: 'none',
    pick_filter: {},
    status: 'active',
    change_note: null,
    created_by: 'pm@example.com',
    created_at: `2026-10-0${version}T00:00:00.000Z`,
  }
}

function templateInput(baseVersion: number | null): NewTemplateVersionInput {
  return {
    clientId: 'client-a',
    templateKey: 'welcome-note',
    baseVersion,
    name: 'Note',
    subject: 'Subject 2',
    body: 'Body 2',
    factSource: 'none',
    pickMode: 'none',
    pickFilter: {},
    status: 'active',
    createdBy: 'pm@example.com',
  }
}

function settings(): EmailSettings {
  return {
    enabled: true,
    sendMailbox: 'info@example.com',
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: { max: 2, windowDays: 7 },
    recipientAllowlist: ['test@example.com'],
    sameTemplateCooldownHours: 24,
    callPromptHours: 24,
    guardrails: { allowedLinkHosts: ['example.com'], rules: [] },
    providers: {},
  }
}

function settingsRow(version: number): Record<string, unknown> {
  return {
    id: `s-${version}`,
    client_id: 'client-a',
    version,
    settings: serialiseEmailSettings(settings()),
    change_note: null,
    created_by: 'pm@example.com',
    created_at: `2026-10-0${version}T00:00:00.000Z`,
  }
}

describe('template append preconditions are enforced by the application', () => {
  it('a stale baseVersion is a conflict even without a database unique constraint', async () => {
    const { db, tables } = createFakeDb({ seed: { crm_email_templates: [templateRow(1), templateRow(2)] } })
    const result = await appendTemplateVersion(db, templateInput(1))
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(tables.crm_email_templates).toHaveLength(2)
  })

  it('a baseVersion ahead of the current version never leaves a version gap', async () => {
    const { db, tables } = createFakeDb({ seed: { crm_email_templates: [templateRow(1)] } })
    const result = await appendTemplateVersion(db, templateInput(5))
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(tables.crm_email_templates).toHaveLength(1)
  })

  it('creating a key that already exists (baseVersion null) is a conflict', async () => {
    const { db, tables } = createFakeDb({ seed: { crm_email_templates: [templateRow(1)] } })
    const result = await appendTemplateVersion(db, templateInput(null))
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(tables.crm_email_templates).toHaveLength(1)
  })
})

describe('settings append preconditions are enforced by the application', () => {
  const input = (baseVersion: number | null) => ({
    clientId: 'client-a',
    baseVersion,
    settings: settings(),
    createdBy: 'pm@example.com',
  })

  it('a stale baseVersion is a conflict even without a database unique constraint', async () => {
    const { db, tables } = createFakeDb({ seed: { crm_email_settings: [settingsRow(1), settingsRow(2)] } })
    const result = await appendEmailSettings(db, input(1))
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(tables.crm_email_settings).toHaveLength(2)
  })

  it('a baseVersion ahead of the current version never leaves a version gap', async () => {
    const { db, tables } = createFakeDb({ seed: { crm_email_settings: [settingsRow(1)] } })
    const result = await appendEmailSettings(db, input(5))
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(tables.crm_email_settings).toHaveLength(1)
  })

  it('first settings row (baseVersion null) is refused when one already exists', async () => {
    const { db, tables } = createFakeDb({ seed: { crm_email_settings: [settingsRow(1)] } })
    const result = await appendEmailSettings(db, input(null))
    expect(result).toMatchObject({ ok: false, reason: 'conflict' })
    expect(tables.crm_email_settings).toHaveLength(1)
  })
})
