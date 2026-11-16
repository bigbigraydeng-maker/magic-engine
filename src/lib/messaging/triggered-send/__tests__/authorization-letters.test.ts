/**
 * The authorization commands for a letter list (the AI follow-up letters, design 2026-11-17 §4.5): the same four
 * commands, picked by the deps' trigger (absent = the welcome letter); propose binds version 1 and the list's
 * fingerprint; every letter's template is checked against its pin; only a trial may be authorized in this version.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { EmailTemplateVersion } from '@/lib/crm/email-templates/types'
import { authorizeCommand } from '../authorization-authorize'
import { proposeCommand, revokeCommand } from '../authorization-commands'
import type { CommandDeps, TemplateRead } from '../authorization-core'
import type { NewProposal } from '../authorization-store'
import { statusQuery } from '../authorization-status'
import { ruleSha256, type LetterRule } from '../rule'
import { lettersFingerprint } from '../send-rule'
import { ACTOR, CLIENT, fakeWorld, sendableRule, type FakeWorld } from './authorization-fakes'
import { entryFor, followupTemplate, letterRule, letterTemplate } from './letter-fakes'

const TRIAL = ['lead@example.com']
let w: FakeWorld
let deps: CommandDeps
let templates: Map<string, EmailTemplateVersion | null>
let inserted: NewProposal[]

function trialRule(): LetterRule {
  return letterRule({ allowlist: TRIAL })
}

beforeEach(() => {
  w = fakeWorld()
  templates = new Map([
    ['auto-ai-catalogue', letterTemplate()],
    ['auto-ai-d7', followupTemplate()],
  ])
  inserted = []
  const insert = w.store.insertProposal.bind(w.store)
  w.store.insertProposal = async (p) => {
    inserted.push(p)
    return insert(p)
  }
  deps = { ...w.deps, trigger: 'crm_ai_followup', loadTemplate: async (_c, key): Promise<TemplateRead> => ({ ok: true, template: templates.get(key) ?? null }) }
})

const propose = (rule: unknown, d: CommandDeps = deps) => proposeCommand(d, CLIENT, ACTOR, { client_id: CLIENT, account: 'cts', daily_cap: 10, rule, confirm: true })

function seedProposal(rule: LetterRule = trialRule()) {
  return w.store.seed({ triggerKey: 'crm_ai_followup', rule, ruleSha256: ruleSha256(rule), templateVersion: 1, templateSha256: lettersFingerprint(rule.send.letters) })
}

describe('propose a letter list', () => {
  it('🔴 binds version 1 and the list fingerprint, under its own trigger; the event names the trigger', async () => {
    const rule = trialRule()
    const res = await propose(rule)
    expect(res).toMatchObject({ status: 200, body: { mode: 'PROPOSED', proposal: { template_key: null, letter_keys: ['catalogue_2027', 'followup_d7'], template_version: 1 } } })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ triggerKey: 'crm_ai_followup', channel: 'email', templateVersion: 1, templateSha256: lettersFingerprint(rule.send.letters), ruleSha256: ruleSha256(rule) })
    expect(w.events.map((e) => e.data.trigger_key)).toEqual(['crm_ai_followup'])
  })

  it('🔴 the rule\'s kind must be the trigger\'s: no letter list for the welcome letter, no single template for the follow-ups', async () => {
    expect((await propose(trialRule(), w.deps)).body).toMatchObject({ error: 'RULE_KIND_MISMATCH', trigger: 'welcome', rule_kind: 'letters' })
    expect((await propose(sendableRule())).body).toMatchObject({ error: 'RULE_KIND_MISMATCH', trigger: 'crm_ai_followup', rule_kind: 'single' })
    expect(inserted).toHaveLength(0)
  })

  it('🔴 every letter\'s template must be readable, sendable and exactly the pinned version', async () => {
    templates.set('auto-ai-d7', followupTemplate({ version: 2 }))
    expect(await propose(trialRule())).toMatchObject({ status: 409, body: { error: 'TEMPLATE_CHANGED', letter_key: 'followup_d7' } })
    templates.set('auto-ai-d7', followupTemplate({ body: 'Hi {{first_name}}, {{tour_name}}' }))
    const rule = letterRule({ allowlist: TRIAL, letters: [entryFor('catalogue_2027', letterTemplate()), entryFor('followup_d7', followupTemplate({ body: 'Hi {{first_name}}, {{tour_name}}' }))] })
    expect(await propose(rule)).toMatchObject({ status: 422, body: { error: 'TEMPLATE_NOT_SENDABLE', reason: 'template_placeholder_not_allowed', letter_key: 'followup_d7' } })
    templates.set('auto-ai-d7', null)
    expect(await propose(trialRule())).toMatchObject({ status: 422, body: { error: 'TEMPLATE_NOT_SENDABLE', reason: 'template_missing' } })
    expect(inserted).toHaveLength(0)
  })

  it('the welcome letter\'s proposal is unchanged when no trigger is given', async () => {
    const res = await propose(sendableRule({ recipient_allowlist: TRIAL }), w.deps)
    expect(res.body).toMatchObject({ mode: 'PROPOSED', proposal: { template_key: 'auto-welcome', letter_keys: null } })
    expect(inserted[0]).toMatchObject({ triggerKey: 'welcome' })
    expect(w.events[0].data.trigger_key).toBe('welcome')
  })
})

describe('authorize a letter list', () => {
  const authorize = (id: string, ruleSha: string, templateSha: string, d: CommandDeps = deps) =>
    authorizeCommand(d, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: id, rule_sha256: ruleSha, template_sha256: templateSha, backfill_hours: 0, expires_in_days: 30, confirm: true })

  it('🔴 a trial is authorized and armed (no rehearsal needed for a letter list)', async () => {
    const p = seedProposal()
    const res = await authorize(p.id, p.ruleSha256, p.templateSha256 as string)
    expect(res).toMatchObject({ status: 200, body: { mode: 'AUTHORIZED' } })
    expect(w.store.rows.find((r) => r.id === p.id)?.activatedAt).not.toBeNull()
    expect(w.events.at(-1)?.data).toMatchObject({ change: 'authorized', trigger_key: 'crm_ai_followup' })
  })

  it('🔴 real guests (no trial list) cannot be authorized in this version', async () => {
    const p = seedProposal(letterRule({ allowlist: null }))
    expect(await authorize(p.id, p.ruleSha256, p.templateSha256 as string)).toMatchObject({ status: 422, body: { error: 'FORMAL_LETTERS_NOT_ENABLED' } })
  })

  it('🔴 a letter\'s template changed since the proposal: refused', async () => {
    const p = seedProposal()
    templates.set('auto-ai-catalogue', letterTemplate({ version: 3 }))
    expect(await authorize(p.id, p.ruleSha256, p.templateSha256 as string)).toMatchObject({ status: 409, body: { error: 'TEMPLATE_CHANGED', letter_key: 'catalogue_2027' } })
  })

  it('a stored list fingerprint that does not match its letters: refused', async () => {
    const p = seedProposal()
    p.templateSha256 = 'b'.repeat(64)
    expect(await authorize(p.id, p.ruleSha256, 'b'.repeat(64))).toMatchObject({ status: 409, body: { error: 'TEMPLATE_CHANGED' } })
  })

  it('🔴 the welcome letter\'s commands never touch a follow-up authorization (and the other way round)', async () => {
    const p = seedProposal()
    expect(await authorize(p.id, p.ruleSha256, p.templateSha256 as string, w.deps)).toMatchObject({ status: 404, body: { error: 'PROPOSAL_NOT_FOUND' } })
    expect(await revokeCommand(w.deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p.id, reason: 'stop' })).toMatchObject({ status: 404 })
    const welcome = w.store.seed()
    expect(await revokeCommand(deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: welcome.id, reason: 'stop' })).toMatchObject({ status: 404 })
    expect(await revokeCommand(deps, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: p.id, reason: 'stop' })).toMatchObject({ status: 200, body: { mode: 'REVOKED' } })
    expect(w.store.rows.find((r) => r.id === welcome.id)?.revokedAt).toBeNull()
  })
})

describe('status of a letter list', () => {
  it('shows each letter with its template now and its pin, and names the trigger', async () => {
    seedProposal()
    const res = await statusQuery({ ...w.statusDeps, ...deps }, CLIENT, { canAuthorize: true })
    expect(res.body).toMatchObject({ trigger: 'crm_ai_followup', proposal: { template: null, problem: null } })
    const letters = (res.body.proposal as { letters: Array<Record<string, unknown>> }).letters
    expect(letters.map((l) => l.letter_key)).toEqual(['catalogue_2027', 'followup_d7'])
    expect(letters[0]).toMatchObject({ pinned_version: 2, template: { key: 'auto-ai-catalogue', check: 'ok', version: 2 } })
  })

  it('an authorization whose letter template changed reads template_changed (as the sender will find it)', async () => {
    const rule = trialRule()
    w.store.seed({ triggerKey: 'crm_ai_followup', rule, ruleSha256: ruleSha256(rule), templateVersion: 1, templateSha256: lettersFingerprint(rule.send.letters), authorizedAt: '2026-11-19T00:00:00.000Z', activatedAt: '2026-11-19T00:00:01.000Z', expiresAt: '2027-01-01T00:00:00.000Z' })
    expect((await statusQuery({ ...w.statusDeps, ...deps }, CLIENT, { canAuthorize: true })).body).toMatchObject({ authorization: { state: 'active' } })
    templates.set('auto-ai-d7', followupTemplate({ version: 5 }))
    expect((await statusQuery({ ...w.statusDeps, ...deps }, CLIENT, { canAuthorize: true })).body).toMatchObject({ authorization: { state: 'template_changed' } })
  })
})

describe('P1-1 / P2-1: the gates block and the kind of rule must agree, at proposal and at authorization', () => {
  const authorize = (id: string, ruleSha: string, templateSha: string, d: CommandDeps) =>
    authorizeCommand(d, CLIENT, ACTOR, { client_id: CLIENT, authorization_id: id, rule_sha256: ruleSha, template_sha256: templateSha, backfill_hours: 0, expires_in_days: 30, confirm: true })

  function withoutGates(): Omit<LetterRule, 'gates'> {
    const { gates: _gates, ...rest } = trialRule()
    return rest
  }

  it('🔴 a one-letter rule with ANY gates block is refused (even the welcome letter\'s own values)', async () => {
    const welcomeGates = { sales_email: true, legacy_welcomed: true, stale: true, count_legacy_batch: false }
    const res = await propose({ ...sendableRule({ recipient_allowlist: TRIAL }), gates: welcomeGates }, w.deps)
    expect(res).toMatchObject({ status: 422, body: { error: 'RULE_INVALID', detail: 'gates is only allowed on a rule that sends a list of letters' } })
    const rule = { ...sendableRule({ recipient_allowlist: TRIAL }), gates: { ...welcomeGates, sales_email: false } }
    const p = w.store.seed({ rule, ruleSha256: ruleSha256(rule) })
    expect(await authorize(p.id, p.ruleSha256, p.templateSha256 as string, w.deps)).toMatchObject({ status: 422, body: { error: 'RULE_INVALID' } })
    expect(inserted).toHaveLength(0)
  })

  it('🔴 a letter list without gates is refused when proposed AND when authorized (a stored one)', async () => {
    const rule = withoutGates()
    expect(await propose(rule)).toMatchObject({ status: 422, body: { error: 'RULE_INVALID', detail: 'gates is required for a rule that sends a list of letters' } })
    expect(inserted).toHaveLength(0)
    const p = w.store.seed({ triggerKey: 'crm_ai_followup', rule, ruleSha256: ruleSha256(rule), templateVersion: 1, templateSha256: lettersFingerprint(rule.send.letters) })
    expect(await authorize(p.id, p.ruleSha256, p.templateSha256 as string, deps)).toMatchObject({ status: 422, body: { error: 'RULE_INVALID' } })
    expect(w.store.rows.find((r) => r.id === p.id)?.authorizedAt).toBeNull()
  })
})

describe('P1-1: the status page shows the same summary for a letter list', () => {
  it('the proposal and the authorization in force both list the letters, without an audience line', async () => {
    seedProposal()
    const body = (await statusQuery({ ...w.statusDeps, ...deps }, CLIENT, { canAuthorize: true })).body as { proposal: { summary: string[] } }
    expect(body.proposal.summary.some((l) => l.startsWith('· catalogue_2027：'))).toBe(true)
    expect(body.proposal.summary.join('\n')).not.toContain('Facebook 表单留资')
  })
})
