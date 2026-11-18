import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ConfirmationDocument from '@/components/confirmation/ConfirmationDocument'
import { sampleConfirmation } from '@/lib/confirmation/defaults'

describe('ConfirmationDocument (what the PDF prints)', () => {
  it('shows the real example completely: every day, the hotel, and all 14 numbered tips', () => {
    const html = renderToStaticMarkup(<ConfirmationDocument data={sampleConfirmation()} />)
    for (const needle of ['CTS4270729', '29 Jul', '30 Jul', '31 Jul', 'Wanda Moments Beijing Dongba', '14. Tipping', 'Have a nice trip']) {
      expect(html).toContain(needle)
    }
  })

  it('prints only one tour code even though several places show it', () => {
    const html = renderToStaticMarkup(<ConfirmationDocument data={sampleConfirmation()} />)
    expect([...new Set(html.match(/CTS\d{5,}/g))]).toEqual(['CTS4270729'])
  })
})
