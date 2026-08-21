import { describe, expect, it } from 'vitest'
import { prepareReferenceLoopChange, type ReferenceLoopInput } from '..'

const finding = {
  pillar: 'seo',
  severity: 'high',
  statement: 'Google maps the query to a broader page instead of the dedicated hub.',
  evidence: [
    {
      source: { kind: 'gsc', sourceId: 'cts-nz-page-query-2026-08-20' },
      observedAt: '2026-08-20T16:02:44.676Z',
      rawLocator: { known: false, reason: 'not_recorded_by_source' },
      interpretation: { known: true, value: { parserVersion: 'gsc-page-query-v1' } },
      confidence: { known: true, value: 1 },
    },
  ],
} as const

function input(overrides: Partial<ReferenceLoopInput> = {}): ReferenceLoopInput {
  const verification = {
    metricRef: 'gsc.page_query.ctr',
    windowDays: 28,
    baseline: 'previous 28-day NZ web window',
    criteria: {
      success: 'dedicated China hub gains impressions/clicks for china tours',
      failure: 'homepage remains the selected URL with no hub gain',
      indeterminate: 'privacy filtering or insufficient impressions',
    },
  } as const

  return {
    clientId: 'c11e0000-0000-4000-8000-00000000000a',
    clientDomain: 'ctstours.co.nz',
    targetPageUrl: 'https://www.ctstours.co.nz/',
    finding,
    prescription: {
      goalId: { known: false, reason: 'not_recorded_by_source' },
      covers: [finding],
      notDoing: [
        {
          statement: 'Do not add more generic China copy.',
          reason: 'The evidence points to page ownership, not content quantity.',
        },
      ],
      orderingRationale: 'Clarify URL ownership before expanding content.',
    },
    findingRefs: ['gsc:cts:2026-07-23..2026-08-20:china-tours'],
    intents: [
      {
        field: 'meta_title',
        proposedValue: 'Escorted Asia Tours from New Zealand | CTS Tours',
        semanticIntent: {
          known: true,
          value: 'Reserve the broad homepage for the wider Asia proposition.',
        },
      },
    ],
    verification,
    providers: {
      github: null,
      wordpress: {
        connected: true,
        provider: 'wordpress',
        siteUrl: 'https://www.ctstours.co.nz',
        username: 'fixture-only',
        tokenHint: null,
        status: 'connected',
        lastError: null,
        lastTestedAt: '2026-08-20T04:00:56.944Z',
        yoastPluginInstalled: true,
        wpDefaultCategoryId: null,
      },
      shopify: null,
    },
    snapshot: {
      ok: true,
      provider: 'wordpress',
      fetchedAt: '2026-08-20T16:10:00.000Z',
      rawFields: {
        title: 'See all of China, the way it deserves.',
        content: '<main>CTS escorted tours across Asia.</main>',
        seoTitle: 'China Tours from New Zealand | CTS Tours - Since 1928',
        seoDescription: 'Discover escorted China tours from New Zealand with CTS Tours.',
      },
      versionToken: 'fixture-wordpress-version',
    },
    redline: { available: true, phrases: [] },
    providerCheck: { evaluated: true, passed: true },
    provenance: {
      clientIdSource: 'test.fixture',
      targetPageUrlSource: 'gsc.page_query',
      findingSource: 'gsc.page_query',
      prescriptionSource: 'customer_zero.reasoning',
      intentsSource: 'customer_zero.fixture',
      snapshotSource: 'public_page.fixture',
      redlineSource: 'test.fixture',
      providerCheckSource: 'test.fixture',
      verificationSource: 'customer_zero.fixture',
      findingRefsSource: 'gsc.page_query',
      collectedAt: '2026-08-20T16:10:00.000Z',
      window: {
        known: true,
        value: { startAt: '2026-07-23', endAt: '2026-08-20' },
      },
    },
    ...overrides,
  }
}

describe('prepareReferenceLoopChange', () => {
  it('builds a validated, version-pinned request without side effects', () => {
    const result = prepareReferenceLoopChange(input())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preparation.authorizationReadiness).toBe('validation_passed')
    expect(result.preparation.request.basedOnVersion).toEqual({
      known: true,
      value: 'fixture-wordpress-version',
    })
    expect(result.preparation.request.constraints.doNotTouch).toEqual([
      'meta_description',
      'content_html',
    ])
    expect(result.preparation.diff).toEqual({
      ok: true,
      changes: [
        {
          field: 'meta_title',
          before: 'China Tours from New Zealand | CTS Tours - Since 1928',
          after: 'Escorted Asia Tours from New Zealand | CTS Tours',
          changed: true,
        },
      ],
    })
  })

  it('keeps failed validation out of the authorization-ready state', () => {
    const result = prepareReferenceLoopChange(
      input({ providerCheck: { evaluated: false, reason: 'not checked' } }),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preparation.validation.ok).toBe(false)
    expect(result.preparation.authorizationReadiness).toBe('validation_failed')
  })

  it('fails closed when prescription lineage does not cover the finding', () => {
    const otherFinding = { ...finding, statement: 'A different finding.' }
    const result = prepareReferenceLoopChange(
      input({ prescription: { ...input().prescription, covers: [otherFinding] } }),
    )

    expect(result).toMatchObject({
      ok: false,
      stage: 'input',
      code: 'prescription_lineage_mismatch',
    })
  })

  it('keeps frozen finding identity stable when the same finding gains more evidence', () => {
    const changedEvidence = {
      ...finding,
      evidence: [{
        ...finding.evidence[0],
        source: { kind: 'gsc', sourceId: 'different-source-row' },
      }],
    }
    const result = prepareReferenceLoopChange(input({
      prescription: { ...input().prescription, covers: [changedEvidence] },
    }))

    expect(result).toMatchObject({ ok: true })
  })

  it('rejects empty provenance sources and malformed evidence windows', () => {
    const base = input().provenance
    expect(prepareReferenceLoopChange(input({
      provenance: { ...base, findingSource: '   ' },
    }))).toMatchObject({ ok: false, code: 'provenance_invalid' })
    expect(prepareReferenceLoopChange(input({
      provenance: {
        ...base,
        window: { known: true, value: { startAt: '2026-08-21', endAt: '2026-08-20' } },
      },
    }))).toMatchObject({ ok: false, code: 'provenance_invalid' })
  })

  it('fails closed before drafting when the page belongs to another domain', () => {
    const result = prepareReferenceLoopChange(
      input({ targetPageUrl: 'https://example.invalid/' }),
    )

    expect(result).toMatchObject({
      ok: false,
      stage: 'resolve',
      code: 'canonical_identity_unknown',
    })
  })
})
