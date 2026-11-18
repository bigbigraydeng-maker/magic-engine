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
