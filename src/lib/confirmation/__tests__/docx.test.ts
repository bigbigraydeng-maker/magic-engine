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
    expect(xml).toContain('DEMO123456')
    for (const needle of ['29 Jul', '30 Jul', '31 Jul', 'Example Grand Hotel Beijing', 'Forbidden City', '北京示例大酒店']) {
      expect(xml).toContain(needle)
    }
  })

  it('never prints a second, different tour code (source file had DEMO123465 vs DEMO123456)', async () => {
    const xml = await documentXml(await buildConfirmationDocx(sampleConfirmation()))
    const codes = new Set(xml.match(/DEMO\d{6}/g))
    expect([...codes]).toEqual(['DEMO123456'])
  })

  it('numbers tips automatically so editing the list never leaves duplicate numbers', async () => {
    const xml = await documentXml(await buildConfirmationDocx(sampleConfirmation()))
    expect(xml).toContain('14. Tipping')
    expect(xml).toContain('13. Emergency Contacts')
    expect(xml).toContain('12. Power Bank Notice')
  })
})
