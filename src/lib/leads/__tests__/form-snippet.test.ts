import { describe, it, expect } from 'vitest'
import { buildLeadFormHtml, buildLeadFormSnippet, buildLeadFormInstalls } from '../form-snippet'

const OPTS = { clientId: 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84', apiBase: 'https://app.magicengine.com.au' }

describe('buildLeadFormHtml', () => {
  it('posts to the client-scoped leads endpoint', () => {
    const html = buildLeadFormHtml(OPTS)
    expect(html).toContain('https://app.magicengine.com.au/api/clients/d5c98811-1c1d-4ded-bdf0-4cefec6afb84/leads')
  })

  it('collects both server-required fields (name + phone) and marks them required', () => {
    const html = buildLeadFormHtml(OPTS)
    expect(html).toMatch(/name="name"[^>]*required/)
    expect(html).toMatch(/name="phone"[^>]*required/)
  })

  it('carries the honeypot field name the sanitiser checks', () => {
    expect(buildLeadFormHtml(OPTS)).toContain('name="company_hp"')
  })

  it('trims a trailing slash on apiBase so the URL is not doubled', () => {
    const html = buildLeadFormHtml({ ...OPTS, apiBase: 'https://app.magicengine.com.au/' })
    expect(html).toContain('.com.au/api/clients/')
    expect(html).not.toContain('.com.au//api/clients/')
  })

  it('only ever calls its own lead endpoint — no other network origin', () => {
    const html = buildLeadFormHtml(OPTS)
    const fetches = html.match(/fetch\(([^)]*)/g) ?? []
    expect(fetches).toHaveLength(1)
    // the single fetch target is the data-me-endpoint attribute, not a literal URL
    expect(html).toContain('root.getAttribute(\'data-me-endpoint\')')
  })

  it('escapes a business name into the heading (no raw HTML injection)', () => {
    const html = buildLeadFormHtml({ ...OPTS, businessName: 'A & B <Tiles>' })
    expect(html).toContain('A &amp; B &lt;Tiles&gt;')
    expect(html).not.toContain('<Tiles>')
  })

  it('rejects a non-hex accent and falls back to the default (no CSS injection)', () => {
    const html = buildLeadFormHtml({ ...OPTS, accent: 'red; } body{display:none' })
    // the malicious payload must not land in the stylesheet…
    expect(html).not.toContain('background:red')
    expect(html).not.toContain('body{display:none')
    // …and the button uses the safe default instead
    expect(html).toContain('background:#1A1A1A')
  })

  it('applies a valid hex accent', () => {
    expect(buildLeadFormHtml({ ...OPTS, accent: '#C4912E' })).toContain('background:#C4912E')
  })
})

describe('buildLeadFormInstalls / buildLeadFormSnippet', () => {
  it('covers generic, wordpress and webflow', () => {
    expect(buildLeadFormInstalls().map(i => i.platform)).toEqual(['generic', 'wordpress', 'webflow'])
  })

  it('bundles html + installs', () => {
    const s = buildLeadFormSnippet(OPTS)
    expect(s.html).toContain('me-lead-form')
    expect(s.installs).toHaveLength(3)
  })
})
