import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HERO_CHOICES, matchHeroName, pickHeroName } from '../hero-rules'

const HERO_DIR = path.join(process.cwd(), 'templates', 'tailor-made-itinerary', 'heroes')

describe('cover picker images', () => {
  it('every choice has a full-size cover and a thumbnail', () => {
    for (const c of HERO_CHOICES) {
      expect(existsSync(path.join(HERO_DIR, `${c.name}.jpg`)), `${c.name}.jpg`).toBe(true)
      expect(existsSync(path.join(HERO_DIR, 'thumbs', `${c.name}.jpg`)), `thumbs/${c.name}.jpg`).toBe(true)
    }
  })
})

describe('Shanghai Disneyland cover', () => {
  it('a Disney day gets its own cover, not the Disney + Universal composite', () => {
    expect(matchHeroName('Full day at Shanghai Disneyland')).toBe('shanghai-disneyland')
    expect(matchHeroName('上海迪士尼乐园一日游')).toBe('shanghai-disneyland')
    expect(pickHeroName({ title: 'Family fun', route: ['Shanghai Disneyland', 'Beijing'] })).toBe('shanghai-disneyland')
  })

  it('Universal Beijing still uses the family theme-park composite', () => {
    expect(matchHeroName('Universal Beijing Resort')).toBe('family-theme-parks')
  })
})
