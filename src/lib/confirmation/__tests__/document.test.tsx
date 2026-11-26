import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ConfirmationDocument from '@/components/confirmation/ConfirmationDocument'
import { sampleConfirmation } from '@/lib/confirmation/defaults'

describe('ConfirmationDocument (what the PDF prints)', () => {
  it('shows the real example completely: every day, the hotel, and all 14 numbered tips', () => {
    const html = renderToStaticMarkup(<ConfirmationDocument data={sampleConfirmation()} />)
    for (const needle of ['DEMO123456', '29 Jul', '30 Jul', '31 Jul', 'Example Grand Hotel Beijing', '14. Tipping', 'Have a nice trip']) {
      expect(html).toContain(needle)
    }
  })

  it('prints only one tour code even though several places show it', () => {
    const html = renderToStaticMarkup(<ConfirmationDocument data={sampleConfirmation()} />)
    expect([...new Set(html.match(/DEMO\d{6}/g))]).toEqual(['DEMO123456'])
  })
})

describe('print safety', () => {
  it('does not use a <header> element: the dashboard print CSS hides every <header>, which dropped the title block from the PDF', () => {
    expect(renderToStaticMarkup(<ConfirmationDocument data={sampleConfirmation()} />)).not.toContain('<header')
  })
})

describe('cover styles', () => {
  it('photo cover shows the title, route and facts and breaks to a new page; banner does not', () => {
    const photo = renderToStaticMarkup(<ConfirmationDocument data={sampleConfirmation()} heroSrc="data:image/jpeg;base64,AAAA" />)
    expect(photo).toContain('Beijing Highlights')
    expect(photo).toContain('break-after-page')
    expect(photo).toContain('data:image/jpeg;base64,AAAA')
    const banner = renderToStaticMarkup(
      <ConfirmationDocument data={{ ...sampleConfirmation(), cover: { style: 'banner', hero: 'auto', title: '' } }} />,
    )
    expect(banner).not.toContain('break-after-page')
  })
})

describe('unknown hotel stars', () => {
  it('shows no stars when the rating is unknown (0)', () => {
    const d = sampleConfirmation()
    d.hotels = [{ ...d.hotels[0], stars: 0 }]
    expect(renderToStaticMarkup(<ConfirmationDocument data={d} />)).not.toContain('★')
  })
})

describe('logos in the preview / PDF', () => {
  const L = 'data:image/png;base64,AAAA'
  const R = 'data:image/jpeg;base64,BBBB'
  it('both logos sit together on the left in a table header, which browsers repeat on every printed page', () => {
    const html = renderToStaticMarkup(<ConfirmationDocument data={{ ...sampleConfirmation(), logos: { left: L, right: R } }} />)
    const start = html.indexOf('<thead data-logo-header')
    const thead = html.slice(start, html.indexOf('</thead>', start))
    expect(start).toBeGreaterThan(-1)
    expect(thead).toContain(L)
    expect(thead).toContain(R)
    expect(thead.indexOf(L)).toBeLessThan(thead.indexOf(R))
    expect(html.split(L).length - 1).toBe(1)
    expect(thead).not.toContain('justify-between')
  })
  it('one logo still prints; no logos -> no header row at all', () => {
    const one = renderToStaticMarkup(<ConfirmationDocument data={{ ...sampleConfirmation(), logos: { left: '', right: R } }} />)
    expect(one).toContain('data-logo-header')
    expect(renderToStaticMarkup(<ConfirmationDocument data={sampleConfirmation()} />)).not.toContain('data-logo-header')
  })
})

describe('one-line cover title (PM 2026-11-19: 中文字必须要缩到一行)', () => {
  it('never wraps and shrinks with length', () => {
    const html = renderToStaticMarkup(<ConfirmationDocument data={{ ...sampleConfirmation(), cover: { style: 'photo', hero: 'auto', title: '' } }} />)
    const h1 = html.slice(html.indexOf('<h1'), html.indexOf('</h1>'))
    expect(h1).toContain('whitespace-nowrap')
    expect(h1).toContain('Welcome to China! 欢迎到中国！')
    expect(h1).toMatch(/font-size:min\(40px, ?calc\(96cqw/)
  })
})
