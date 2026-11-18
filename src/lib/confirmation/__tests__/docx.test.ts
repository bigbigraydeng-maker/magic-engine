// @vitest-environment node
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildConfirmationDocx } from '@/lib/confirmation/docx'
import { sampleConfirmation } from '@/lib/confirmation/defaults'

async function documentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  return zip.file('word/document.xml')!.async('string')
}

describe('buildConfirmationDocx', () => {
  it('produces a real .docx (zip) containing the tour code, every day and the hotel', async () => {
    const buf = await buildConfirmationDocx(sampleConfirmation())
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    const xml = await documentXml(buf)
    expect(xml).toContain('CTS4270729')
    for (const needle of ['29 Jul', '30 Jul', '31 Jul', 'Wanda Moments Beijing Dongba', 'Forbidden City', '北京东坝万达美华酒店']) {
      expect(xml).toContain(needle)
    }
  })

  it('never prints a second, different tour code (source file had CTS4270429 vs CTS4270729)', async () => {
    const xml = await documentXml(await buildConfirmationDocx(sampleConfirmation()))
    const codes = new Set(xml.match(/CTS\d{5,}/g))
    expect([...codes]).toEqual(['CTS4270729'])
  })

  it('numbers tips automatically so editing the list never leaves duplicate numbers', async () => {
    const xml = await documentXml(await buildConfirmationDocx(sampleConfirmation()))
    expect(xml).toContain('14. Tipping')
    expect(xml).toContain('13. Emergency Contacts')
    expect(xml).toContain('12. Power Bank Notice')
  })
})
