import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fitHero } from '@/lib/confirmation/docx'
import { oneLineTitlePx, titleUnits } from '@/lib/confirmation/cover'
import { resolveHeroName, coverRouteStops, coverTitle, jpegSize, heroLabel } from '@/lib/confirmation/cover'
import { parseConfirmation } from '@/lib/confirmation/validate'
import { sampleConfirmation, emptyConfirmation } from '@/lib/confirmation/defaults'

describe('cover picture', () => {
  it('auto picks from the itinerary the way Tailor-made does (Beijing sample -> a Beijing picture)', () => {
    const name = resolveHeroName(sampleConfirmation())
    expect(['summer-palace', 'beijing', 'forbidden-city', 'great-wall', 'tiananmen-square', 'temple-of-heaven']).toContain(name)
  })

  it('a Chongqing trip does not get the Great Wall', () => {
    const d = sampleConfirmation()
    d.days = [{ date: '1 May', route: 'Arrive Chongqing', highlights: 'Hongyadong at night', overnight: 'Chongqing' }]
    expect(resolveHeroName(d)).toBe('chongqing')
  })

  it("staff's choice wins; an unknown name falls back to auto instead of a broken picture", () => {
    const d = sampleConfirmation()
    d.cover = { style: 'photo', hero: 'guilin', title: '' }
    expect(resolveHeroName(d)).toBe('guilin')
    d.cover = { style: 'photo', hero: '../../etc/passwd', title: '' }
    expect(resolveHeroName(d)).not.toContain('..')
  })

  it('route stops are unique overnight cities in order; title has a default', () => {
    const d = sampleConfirmation()
    expect(coverRouteStops(d)).toEqual(['Beijing'])
    expect(coverTitle(emptyConfirmation())).toContain('Welcome to China')
    expect(heroLabel('guilin')).toContain('桂林')
  })

  it('reads a real hero JPEG size', () => {
    const buf = readFileSync(path.join(process.cwd(), 'templates/tailor-made-itinerary/heroes/beijing.jpg'))
    expect(jpegSize(buf)).toEqual({ width: 1400, height: 933 })
  })
})

describe('cover in saved/incoming data', () => {
  it('old drafts without a cover still load, with the default photo cover', () => {
    const { cover: _omit, ...old } = sampleConfirmation()
    const r = parseConfirmation(old)
    expect(r.ok && r.data.cover).toEqual({ style: 'photo', hero: 'auto', title: '' })
  })

  it('rejects a malformed cover', () => {
    expect(parseConfirmation({ ...sampleConfirmation(), cover: { style: 'weird', hero: 'x', title: '' } }).ok).toBe(false)
  })
})

describe('Codex review fixes', () => {
  it("a day routed 'Beijing → Xi'an' that stays overnight in Beijing gets the Beijing picture, not Xi'an", () => {
    const d = sampleConfirmation()
    d.days = [{ date: '1 May', route: "Beijing → Xi'an", highlights: '', overnight: 'Beijing' }]
    expect(resolveHeroName(d)).toBe('beijing')
    for (const route of ["Beijing → Xi'an", "Beijing - Xi'an", "Beijing – Xi'an", "Beijing/Xi'an", "Beijing to Xi'an", "Beijing + Xi'an"]) {
      d.days = [{ date: '1 May', route, highlights: '', overnight: '' }]
      expect(resolveHeroName(d)).toBe('beijing')
    }
  })

  it('portrait pictures are shrunk to fit one page, landscape ones keep their size', () => {
    const portrait = fitHero({ width: 1000, height: 1500 })
    expect(portrait.height).toBeLessThanOrEqual(420)
    expect(Math.abs(portrait.width / portrait.height - 1000 / 1500)).toBeLessThan(0.01)
    expect(fitHero({ width: 1400, height: 933 })).toEqual({ width: 630, height: 420 })
  })
})

describe('one-line title sizing', () => {
  it('Chinese counts about twice as wide as Latin, and the size shrinks so the title fits one line', () => {
    expect(titleUnits('欢迎')).toBeGreaterThan(titleUnits('ab') * 1.5)
    const t = 'Welcome to China! 欢迎到中国！'
    const px = oneLineTitlePx(t, 480, 32)
    expect(px * titleUnits(t)).toBeLessThanOrEqual(480)
    expect(oneLineTitlePx('Beijing', 480, 32)).toBe(32)
    expect(oneLineTitlePx('很长的标题'.repeat(20), 480, 32)).toBe(16)
  })
})
