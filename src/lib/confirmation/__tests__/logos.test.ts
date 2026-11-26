// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import JSZip from 'jszip'
import { docxHeaderLogos, fitLogo, imageSize, isLogo, logoBytes } from '@/lib/confirmation/logos'
import { buildConfirmationDocx } from '@/lib/confirmation/docx'
import { parseConfirmation } from '@/lib/confirmation/validate'
import { sampleConfirmation } from '@/lib/confirmation/defaults'

const PNG = 'data:image/png;base64,' + readFileSync('public/confirmation/powerbank-3c.png').toString('base64')
const JPG = 'data:image/jpeg;base64,' + readFileSync('templates/tailor-made-itinerary/heroes/beijing.jpg').toString('base64')

describe('logo checks', () => {
  it('accepts small PNG/JPEG data URIs or empty, rejects anything else', () => {
    expect(isLogo('')).toBe(true)
    expect(isLogo(PNG)).toBe(true)
    expect(isLogo(JPG)).toBe(true)
    expect(isLogo('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isLogo('https://evil.example/logo.png')).toBe(false)
    expect(isLogo('data:image/png;base64,' + 'A'.repeat(1_600_000))).toBe(false)
  })

  it('reads PNG and JPEG sizes and fits a logo into the header box keeping proportions', () => {
    expect(imageSize(logoBytes(PNG)!.data)).toEqual({ width: 343, height: 257 })
    expect(imageSize(logoBytes(JPG)!.data)).toEqual({ width: 1400, height: 933 })
    const f = fitLogo({ width: 942, height: 708 })
    expect(f.height).toBeLessThanOrEqual(60)
    expect(f.width).toBeLessThanOrEqual(170)
    expect(Math.abs(f.width / f.height - 942 / 708)).toBeLessThan(0.05)
  })

  it('old drafts without logos load with none; malformed logos are refused', () => {
    const { logos: _l, ...old } = sampleConfirmation()
    const r = parseConfirmation(old)
    expect(r.ok && r.data.logos).toEqual({ left: '', right: '' })
    expect(parseConfirmation({ ...sampleConfirmation(), logos: { left: 'javascript:alert(1)', right: '' } }).ok).toBe(false)
  })
})

describe('two logos on every Word page', () => {
  it('puts both logos in the page header, and an uploaded Word file gives them back in the same left/right order', async () => {
    const d = { ...sampleConfirmation(), logos: { left: PNG, right: JPG } }
    const buf = await buildConfirmationDocx(d)
    const zip = await JSZip.loadAsync(buf)
    const header = Object.keys(zip.files).find((f) => /^word\/header\d*\.xml$/.test(f))
    expect(header).toBeTruthy()
    expect((await zip.file(header!)!.async('string')).match(/r:embed=/g)?.length).toBe(2)

    const back = await docxHeaderLogos(new Uint8Array(buf).buffer)
    expect(back).toHaveLength(2)
    expect(back[0].startsWith('data:image/png')).toBe(true)
    expect(back[1].startsWith('data:image/jpeg')).toBe(true)
  })

  it('no logos -> no header at all (nothing empty printed)', async () => {
    const zip = await JSZip.loadAsync(await buildConfirmationDocx(sampleConfirmation()))
    expect(Object.keys(zip.files).some((f) => /^word\/header\d*\.xml$/.test(f))).toBe(false)
  })
})
