import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_PLAY, describeDraft, metaTripletFor, validateDraft, type AdDraft } from '../ad-draft'
import { pausedDraftFacts } from '../paused-draft-facts'
import {
  PARTNER_PAGE_DENIED,
  PARTNER_PAGE_IDENTITY_CHANGED,
  PARTNER_PAGE_UNCONFIGURED,
  PARTNER_PAGE_UNREAD,
  alignPartnerDraft,
  draftStampedWithIdentity,
  partnerPageOpenBlocked,
  partnerPagePublishRefusal,
  partnerShareVerdict,
  readPartnerPageConfig,
  resolvePartnerIdentity,
} from '../partner-page'

const OWN = '11111'
const PARTNER = '22222'

function draft(over: Partial<AdDraft> = {}): AdDraft {
  return {
    kind: 'partner_page',
    clientId: 'c1',
    campaignName: 'Partner page',
    adSetName: 'Group',
    dailyBudget: 20,
    durationDays: 7,
    geoCountries: ['NZ'],
    pageId: OWN,
    partnerIdentity: 'own',
    leadFormId: 'form-1',
    creatives: [{ name: 'EN', primaryText: 'Ask for a quote', headline: 'Leave your details', imageHash: 'hash-1' }],
    ...over,
  }
}

const REVIEW = {
  adAccountId: 'act_1',
  accounts: [{ ad_account_id: 'act_1', currency: 'NZD', daily_cap_cents: 10000, owned_by_client: true }],
  clientCapCents: 20000,
  liveDeliveringCents: 0,
  campaignShapes: [],
}

afterEach(() => { vi.unstubAllGlobals() })

describe('partner page config', () => {
  it('defaults to the client page when the config is missing or not exactly partner', () => {
    expect(readPartnerPageConfig(null)).toEqual({ identity: 'own', partnerPageId: null })
    expect(readPartnerPageConfig({ ads_partner_page: { identity: 'PARTNER', partner_page_id: PARTNER } }).identity).toBe('own')
    expect(resolvePartnerIdentity({ kind: 'partner_page', ownPageId: OWN, leadsConfig: {} })).toEqual({
      ok: true, pageId: OWN, identity: 'own',
    })
    expect(resolvePartnerIdentity({ kind: 'lead_form', ownPageId: OWN, leadsConfig: {
      ads_partner_page: { identity: 'partner', partner_page_id: PARTNER },
    } })).toEqual({ ok: true, pageId: OWN, identity: 'own' })
  })

  it('uses only the configured partner page id, and refuses a switch with no id', () => {
    const leads = { ads_partner_page: { identity: 'partner', partner_page_id: PARTNER } }
    expect(resolvePartnerIdentity({ kind: 'partner_page', ownPageId: OWN, leadsConfig: leads })).toEqual({
      ok: true, pageId: PARTNER, identity: 'partner',
    })
    const missing = resolvePartnerIdentity({
      kind: 'partner_page',
      ownPageId: OWN,
      leadsConfig: { ads_partner_page: { identity: 'partner', partner_page_id: 'not-a-page' } },
    })
    expect(missing).toEqual({ ok: false, reason: PARTNER_PAGE_UNCONFIGURED })
  })

  it('treats a partner id equal to the client page as the client page', () => {
    const leads = { ads_partner_page: { identity: 'partner', partner_page_id: OWN } }
    const resolved = resolvePartnerIdentity({ kind: 'partner_page', ownPageId: OWN, leadsConfig: leads })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.identity).toBe('own')
  })

  it('drops a partner identity smuggled onto another kind', () => {
    const stamped = draftStampedWithIdentity({ ...draft({ kind: 'lead_form' }), partnerIdentity: 'partner' }, OWN, {})
    expect(stamped.ok).toBe(true)
    if (stamped.ok) expect(stamped.draft.partnerIdentity).toBeUndefined()
  })
})

describe('partner page card and open gate', () => {
  it('reuses the lead objective and says which identity, without printing the page id', () => {
    expect(metaTripletFor('partner_page')).toEqual(metaTripletFor('lead_form'))
    expect(DRAFT_PLAY.partner_page).toBe('lead_form_harvest')
    expect(describeDraft(draft())).toContain('客户自己的主页')
    expect(describeDraft(draft({ pageId: PARTNER, partnerIdentity: 'partner' }))).toContain('伙伴主页')
    expect(describeDraft(draft({ pageId: PARTNER, partnerIdentity: 'partner' }))).not.toContain(PARTNER)
    const own = pausedDraftFacts(draft(), '账户', REVIEW)
    const partner = pausedDraftFacts(draft({ pageId: PARTNER, partnerIdentity: 'partner' }), '账户', REVIEW)
    expect(own.scope).toContain('身份主页：客户自己的主页')
    expect(partner.scope).toContain('身份主页：已配置的伙伴主页')
    expect(own.scope).not.toContain('pageId')
    expect(validateDraft(draft({ leadFormId: undefined }))).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'leadFormId' })]),
    )
  })

  it('blocks the old open button and leaves the go-live card', () => {
    expect(partnerPageOpenBlocked('partner_page', 'ad-approval')).toBe(true)
    expect(partnerPageOpenBlocked('partner_page', 'go-live-card')).toBe(false)
    expect(partnerPageOpenBlocked('lead_form', 'ad-approval')).toBe(false)
  })

  it('refuses to build when the confirmed identity no longer matches config', async () => {
    const changed = await alignPartnerDraft(
      draft({ pageId: PARTNER, partnerIdentity: 'partner' }),
      async () => ({ ok: true, ownPageId: OWN, leadsConfig: {} }),
    )
    expect(changed).toEqual({ ok: false, reason: PARTNER_PAGE_IDENTITY_CHANGED })
    const same = await alignPartnerDraft(draft(), async () => ({ ok: true, ownPageId: OWN, leadsConfig: {} }))
    expect(same.ok).toBe(true)
  })
})

describe('partner page permission', () => {
  it('names a missing advertise task or a page that is not shared', () => {
    const page = { state: 'ok' as const, id: PARTNER, tasks: ['ANALYZE'] }
    const shared = { state: 'ok' as const, ids: [PARTNER], more: false }
    expect(partnerShareVerdict(PARTNER, page, shared)).toBe(PARTNER_PAGE_DENIED)
    expect(partnerShareVerdict(PARTNER, { state: 'ok', id: PARTNER, tasks: ['ADVERTISE'] }, {
      state: 'ok', ids: [OWN], more: false,
    })).toBe(PARTNER_PAGE_DENIED)
    expect(partnerShareVerdict(PARTNER, { state: 'ok', id: PARTNER, tasks: null }, {
      state: 'ok', ids: [PARTNER], more: false,
    })).toBeNull()
    expect(partnerShareVerdict(PARTNER, { state: 'denied' }, { state: 'ok', ids: [], more: false })).toBe(PARTNER_PAGE_DENIED)
    expect(partnerShareVerdict(PARTNER, { state: 'unread' }, { state: 'ok', ids: [], more: false })).toBe(PARTNER_PAGE_UNREAD)
  })

  it('does not call Meta when the identity is the client page', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await partnerPagePublishRefusal(draft(), 'act_1', 'tok')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses in Chinese before any create when the partner page is not shared', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('promote_pages')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: OWN }] }) }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ id: PARTNER, tasks: ['ADVERTISE'] }) }
    }))
    const reason = await partnerPagePublishRefusal(
      draft({ pageId: PARTNER, partnerIdentity: 'partner' }),
      'act_1',
      'secret-token',
    )
    expect(reason).toBe(PARTNER_PAGE_DENIED)
    expect(reason).not.toContain('secret-token')
  })

  it('follows the next page of shared pages without using the token-bearing next url', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url))
      if (!String(url).includes('promote_pages')) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: PARTNER, tasks: ['ADVERTISE'] }) }
      }
      if (!String(url).includes('after=')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [{ id: OWN }],
            paging: { cursors: { after: 'cursor-1' }, next: 'https://graph.facebook.com/next?access_token=secret-token' },
          }),
        }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: PARTNER }] }) }
    }))
    expect(await partnerPagePublishRefusal(
      draft({ pageId: PARTNER, partnerIdentity: 'partner' }),
      'act_1',
      'secret-token',
    )).toBeNull()
    expect(urls.some((url) => url.includes('graph.facebook.com/next'))).toBe(false)
    expect(urls.some((url) => url.includes('after=cursor-1'))).toBe(true)
  })

  it('says the permission could not be read when the call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('down')
    }))
    expect(await partnerPagePublishRefusal(
      draft({ pageId: PARTNER, partnerIdentity: 'partner' }),
      'act_1',
      'tok',
    )).toBe(PARTNER_PAGE_UNREAD)
  })
})
