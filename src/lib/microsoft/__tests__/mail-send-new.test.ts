import { describe, it, expect, vi } from 'vitest'
import { previewCompose, sendMailNew } from '../mail-send-new'
import { baseInput, makeFakes, ENABLED, REQUEST_ID } from './mail-send-new-fakes'

describe('sendMailNew', () => {
  it('happy path: sends, records, rekeys, releases lock', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput(), f.deps)

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.messageId).toBe('draft-1')
    expect(r.conversationId).toBe('conv-1')

    const order = ['acquireLock', 'claim', 'insertAudit', 'createDraft', 'sendDraft', 'recordSent']
    const idx = order.map((c) => f.calls.indexOf(c))
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0)
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1])

    expect(f.rekeys).toEqual(['mail:graph-conv-1'])
    expect(f.audits).toHaveLength(1)
    expect(f.audits[0].status).toBe('sent')
    expect(f.audits[0].meta).toBe(`req:${REQUEST_ID}|msg:draft-1`)
    expect(f.calls).toContain('releaseLock')
  })

  it('invalid input: empty subject', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput({ subject: '' }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
    expect(r.reason).toBe('invalid_input')
    expect(f.store.loadLeadsConfig).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('invalid input: whitespace body', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput({ body: '   \n\t  ' }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
    expect(r.reason).toBe('invalid_input')
    expect(f.store.loadLeadsConfig).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('invalid input: requestId not a uuid', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput({ requestId: 'not-a-uuid' }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
    expect(r.reason).toBe('invalid_input')
    expect(f.store.loadLeadsConfig).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('invalid input: subject longer than 200', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput({ subject: 'a'.repeat(201) }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(400)
    expect(r.reason).toBe('invalid_input')
    expect(f.store.loadLeadsConfig).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('config disabled: empty config', async () => {
    const f = makeFakes({ leadsConfig: {} })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(403)
    expect(r.reason).toBe('disabled')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('config disabled: enabled is a string', async () => {
    const f = makeFakes({ leadsConfig: { email_compose: { enabled: 'true' } } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(403)
    expect(r.reason).toBe('disabled')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('config unreadable: loadLeadsConfig throws', async () => {
    const f = makeFakes({ leadsConfigThrows: true })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(503)
    expect(r.reason).toBe('config_unreadable')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('contact not found', async () => {
    const f = makeFakes({ contact: null })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(404)
    expect(r.reason).toBe('not_found')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('no recipient: no primary and no identities', async () => {
    const f = makeFakes({ contact: { id: 'contact-1', primaryEmail: null }, identityEmails: [] })
    const r = await sendMailNew(baseInput({ expectedRecipient: '' }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('no_recipient')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('no recipient: two identities and no primary', async () => {
    const f = makeFakes({
      contact: { id: 'contact-1', primaryEmail: null },
      identityEmails: ['a@gmail.com', 'b@gmail.com'],
    })
    const r = await sendMailNew(baseInput({ expectedRecipient: 'a@gmail.com' }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('no_recipient')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('bad recipient: robot address', async () => {
    const f = makeFakes({ contact: { id: 'contact-1', primaryEmail: 'noreply@x.com' } })
    const r = await sendMailNew(baseInput({ expectedRecipient: 'noreply@x.com' }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('bad_recipient')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('recipient mismatch', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput({ expectedRecipient: 'other@gmail.com' }), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('recipient_mismatch')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('recipient case-insensitive match is allowed', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput({ expectedRecipient: 'AMY@GMAIL.COM' }), f.deps)
    expect(r.ok).toBe(true)
  })

  it('not an enquirer: only mailchimp inbound', async () => {
    const f = makeFakes({ touchKinds: [{ channel: 'email', source: 'mailchimp', direction: 'inbound' }] })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(403)
    expect(r.reason).toBe('not_enquirer')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('not an enquirer: allow_unsolicited lets it through', async () => {
    const f = makeFakes({
      leadsConfig: { email_compose: { enabled: true, allow_unsolicited: true } },
      touchKinds: [{ channel: 'email', source: 'mailchimp', direction: 'inbound' }],
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
  })

  it('DNC blocked: do_not_contact', async () => {
    const f = makeFakes({ dnc: { blocked: true, status: 403, reason: 'do_not_contact', error: 'x' } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(403)
    expect(r.reason).toBe('do_not_contact')
    expect(f.graph.whoAmI).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('DNC check failed', async () => {
    const f = makeFakes({ dnc: { blocked: true, status: 503, reason: 'dnc_check_failed', error: 'x' } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(503)
    expect(r.reason).toBe('dnc_check_failed')
    expect(f.graph.whoAmI).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('mailbox: zero mailboxes', async () => {
    const f = makeFakes({ mailboxes: [] })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(424)
    expect(r.reason).toBe('no_mailbox')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('mailbox: two mailboxes and no send_mailbox configured', async () => {
    const f = makeFakes({
      mailboxes: [
        { connectionId: 'conn-1', account: 'info@client.co.nz' },
        { connectionId: 'conn-2', account: 'sales@client.co.nz' },
      ],
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(424)
    expect(r.reason).toBe('no_mailbox')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('mailbox: two mailboxes with send_mailbox picks the second', async () => {
    const f = makeFakes({
      leadsConfig: { email_compose: { enabled: true, send_mailbox: 'sales@client.co.nz' } },
      mailboxes: [
        { connectionId: 'conn-1', account: 'info@client.co.nz' },
        { connectionId: 'conn-2', account: 'sales@client.co.nz' },
      ],
      whoAmI: 'sales@client.co.nz',
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
    expect(f.graph.createDraft).toHaveBeenCalledTimes(1)
    expect(vi.mocked(f.graph.createDraft).mock.calls[0][0]).toBe('conn-2')
  })

  it('mailbox: whoAmI returns a different address', async () => {
    const f = makeFakes({ whoAmI: 'other@client.co.nz' })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(424)
    expect(r.reason).toBe('mailbox_mismatch')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('mailbox: whoAmI returns null', async () => {
    const f = makeFakes({ whoAmI: null })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(424)
    expect(r.reason).toBe('mailbox_mismatch')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('prior send: already sent returns duplicate', async () => {
    const f = makeFakes({
      prior: { auditId: 'a9', status: 'sent', messageId: 'm9', conversationId: 'conv-9' },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.duplicate).toBe(true)
    expect(r.messageId).toBe('m9')
    expect(r.conversationId).toBe('conv-9')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
    expect(f.store.claimConversation).not.toHaveBeenCalled()
  })

  it('prior send: pending is duplicate_unfinished', async () => {
    const f = makeFakes({
      prior: { auditId: 'a9', status: 'pending', messageId: null, conversationId: 'conv-9' },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('duplicate_unfinished')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('prior send: failed is duplicate_unfinished', async () => {
    const f = makeFakes({
      prior: { auditId: 'a9', status: 'failed', messageId: null, conversationId: 'conv-9' },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('duplicate_unfinished')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('reconcile: prior draft already sent is patched and new send proceeds', async () => {
    const f = makeFakes({
      pending: [{ auditId: 'a0', draftId: 'old', createdAt: '2026-10-20T23:00:00Z' }],
      isStillDraft: { old: false },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
    const patch = f.patches.find((p) => p.auditId === 'a0')
    expect(patch).toBeDefined()
    expect(patch?.patch.status).toBe('sent')
    expect(f.graph.createDraft).toHaveBeenCalledTimes(1)
  })

  it('reconcile: stale draft is deleted and audit failed, new send proceeds', async () => {
    const f = makeFakes({
      pending: [{ auditId: 'a0', draftId: 'old', createdAt: '2026-10-20T23:00:00Z' }],
      isStillDraft: { old: true },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
    expect(f.deletedDrafts).toContain('old')
    const patch = f.patches.find((p) => p.auditId === 'a0')
    expect(patch).toBeDefined()
    expect(patch?.patch.status).toBe('failed')
    expect(f.graph.createDraft).toHaveBeenCalledTimes(1)
  })

  it('reconcile: recent draft still pending blocks the send', async () => {
    const f = makeFakes({
      pending: [{ auditId: 'a0', draftId: 'old', createdAt: '2026-10-20T23:59:30Z' }],
      isStillDraft: { old: true },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('reconcile_pending')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('reconcile: unknown draft state blocks the send', async () => {
    const f = makeFakes({
      pending: [{ auditId: 'a0', draftId: 'old', createdAt: '2026-10-20T23:00:00Z' }],
      isStillDraft: { old: null },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('reconcile_pending')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('quota: user per hour exceeded', async () => {
    const f = makeFakes({ usage: { userLastHour: 30, userLastDay: 0, mailboxLastDay: 0 } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(429)
    expect(r.reason).toBe('quota')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('quota: user per day exceeded', async () => {
    const f = makeFakes({ usage: { userLastHour: 0, userLastDay: 100, mailboxLastDay: 0 } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(429)
    expect(r.reason).toBe('quota')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('quota: mailbox per day exceeded', async () => {
    const f = makeFakes({ usage: { userLastHour: 0, userLastDay: 0, mailboxLastDay: 200 } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(429)
    expect(r.reason).toBe('quota')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('quota: below all limits is allowed', async () => {
    const f = makeFakes({ usage: { userLastHour: 1, userLastDay: 1, mailboxLastDay: 1 } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
  })

  it('quota: configured per_user_per_hour limit', async () => {
    const f = makeFakes({
      leadsConfig: { email_compose: { enabled: true, limits: { per_user_per_hour: 2 } } },
      usage: { userLastHour: 2, userLastDay: 0, mailboxLastDay: 0 },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(429)
    expect(r.reason).toBe('quota')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('lock not available: busy', async () => {
    const f = makeFakes({ lockAvailable: false })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('busy')
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('claim taken: duplicate_unfinished, lock released', async () => {
    const f = makeFakes({ claim: 'taken' })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(409)
    expect(r.reason).toBe('duplicate_unfinished')
    expect(f.calls).toContain('releaseLock')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('claim error: audit_failed, lock released', async () => {
    const f = makeFakes({ claim: 'error' })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
    expect(r.reason).toBe('audit_failed')
    expect(f.calls).toContain('releaseLock')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('audit insert fails: audit_failed, conversation discarded, lock released', async () => {
    const f = makeFakes({ auditInsertFails: true })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
    expect(r.reason).toBe('audit_failed')
    expect(f.graph.createDraft).not.toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
    expect(f.store.discardConversation).toHaveBeenCalled()
    expect(f.calls).toContain('releaseLock')
  })

  it('createDraft error: graph_failed, audit failed, conversation discarded', async () => {
    const f = makeFakes({ createDraft: { error: 'boom' } })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
    expect(r.reason).toBe('graph_failed')
    expect(f.audits[0].status).toBe('failed')
    expect(f.store.discardConversation).toHaveBeenCalled()
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
  })

  it('rekey fails: graph_failed, draft deleted, audit failed', async () => {
    const f = makeFakes({ rekeyOk: false })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
    expect(r.reason).toBe('graph_failed')
    expect(f.deletedDrafts).toContain('draft-1')
    expect(f.graph.sendDraft).not.toHaveBeenCalled()
    expect(f.audits[0].status).toBe('failed')
  })

  it('send rejected: graph_failed, audit failed, draft deleted', async () => {
    const f = makeFakes({ sendOutcome: 'rejected' })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
    expect(r.reason).toBe('graph_failed')
    expect(f.audits[0].status).toBe('failed')
    expect(f.deletedDrafts).toContain('draft-1')
  })

  it('send unknown: send_unknown, audit stays pending with draft meta, draft kept', async () => {
    const f = makeFakes({ sendOutcome: 'unknown' })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(502)
    expect(r.reason).toBe('send_unknown')
    expect(f.audits[0].status).toBe('pending')
    expect(f.audits[0].meta).toBe(`req:${REQUEST_ID}|draft:draft-1`)
    expect(f.deletedDrafts).not.toContain('draft-1')
    expect(f.store.recordSent).not.toHaveBeenCalled()
    expect(f.calls).toContain('releaseLock')
  })

  it('recordSent throws after send: still ok true', async () => {
    const f = makeFakes({ recordSentThrows: true })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.messageId).toBe('draft-1')
  })

  it('footer is appended to the body', async () => {
    const f = makeFakes({
      leadsConfig: { email_compose: { enabled: true, footer: '-- CTS Tours' } },
    })
    const r = await sendMailNew(baseInput(), f.deps)
    expect(r.ok).toBe(true)
    expect(f.graph.createDraft).toHaveBeenCalledTimes(1)
    const args = vi.mocked(f.graph.createDraft).mock.calls[0][1]
    expect(args.body.endsWith('\n\n-- CTS Tours')).toBe(true)
  })

  it('subject CRLF injection is sanitized', async () => {
    const f = makeFakes()
    const r = await sendMailNew(baseInput({ subject: 'Hi\r\nBcc: x@y.com' }), f.deps)
    expect(r.ok).toBe(true)
    expect(f.graph.createDraft).toHaveBeenCalledTimes(1)
    const args = vi.mocked(f.graph.createDraft).mock.calls[0][1]
    expect(args.subject).toBe('Hi Bcc: x@y.com')
  })
})

describe('previewCompose（抽屉打开时的只读预览：和真发同一套判断，不碰 Graph）', () => {
  it('能发：回收件人、邮箱、最近 7 天已发给他几封；没调 whoAmI / 没写任何东西', async () => {
    const f = makeFakes({ recentToContact: 2 })
    const r = await previewCompose({ clientId: 'client-a', contactId: 'contact-1' }, f.deps)
    expect(r).toEqual({ canCompose: true, recipient: 'amy@gmail.com', mailbox: 'info@client.co.nz', sentToContactLast7Days: 2 })
    expect(f.graph.whoAmI).not.toHaveBeenCalled()
    expect(f.store.claimConversation).not.toHaveBeenCalled()
    expect(f.store.insertAudit).not.toHaveBeenCalled()
  })

  it('开关没开 / 没咨询过 / 别再联系 / 没邮箱 / 找不到人 → 不能发，并带原因', async () => {
    const cases: Array<[Parameters<typeof makeFakes>[0], string]> = [
      [{ leadsConfig: {} }, 'disabled'],
      [{ touchKinds: [{ channel: 'email', source: 'mailchimp', direction: 'inbound' }] }, 'not_enquirer'],
      [{ dnc: { blocked: true, status: 403, reason: 'do_not_contact', error: 'x' } }, 'do_not_contact'],
      [{ contact: { id: 'contact-1', primaryEmail: null } }, 'no_recipient'],
      [{ contact: null }, 'not_found'],
      [{ mailboxes: [] }, 'no_mailbox'],
    ]
    for (const [opts, reason] of cases) {
      const f = makeFakes(opts)
      const r = await previewCompose({ clientId: 'client-a', contactId: 'contact-1' }, f.deps)
      expect(r).toMatchObject({ canCompose: false, reason })
    }
  })
})
