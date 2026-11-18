import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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
