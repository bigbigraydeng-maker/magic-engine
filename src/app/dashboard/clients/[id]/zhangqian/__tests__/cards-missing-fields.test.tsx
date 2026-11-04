import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import { OnPageAuditCard, DomainWhoisCard } from '../cards'

type OnPageAuditData = Parameters<typeof OnPageAuditCard>[0]['data']
type DomainWhoisData = Parameters<typeof DomainWhoisCard>[0]['data']

// Reports saved from a real run (Warm Voyage, 2026-11-01) had no `word_count` key at all
// (undefined, not null) — the card threw and the whole discovery page showed
// "Application error: a client-side exception".
describe('discovery cards tolerate fields the agent did not collect', () => {
  it('OnPageAuditCard renders when word_count / vitals are missing or null', () => {
    const data = {
      url: 'https://x.test/', title: 'T', h1: 'H', description: 'D', canonical: 'https://x.test/',
      status_code: 200, images_total: 11, images_no_alt: null, external_links: 0, internal_links: 5,
      checks: { https: true, no_h1: false, no_title: false, broken_links: false, no_description: false, redirect_chain: false, missing_alt_text: false },
      core_web_vitals: { cls: null, lcp: 0, tbt: undefined },
    } as unknown as OnPageAuditData
    expect(() => renderToString(<OnPageAuditCard data={data} />)).not.toThrow()
  })

  it('DomainWhoisCard renders when every field is null or missing', () => {
    const data = { registrar: null, expires_at: null, registered_at: null } as unknown as DomainWhoisData
    expect(() => renderToString(<DomainWhoisCard data={data} />)).not.toThrow()
  })
})
