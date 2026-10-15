import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The client page is far too large to render in a unit test; check the tool-card source instead.
const source = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8')
const dailyPlanCards = source.split('\n').filter((l) => l.includes('<ToolCard') && l.includes('/daily-plan'))

describe('client page tool cards — one 社媒日常 card', () => {
  it('has exactly one card pointing at daily-plan, titled 社媒日常', () => {
    expect(dailyPlanCards).toHaveLength(1)
    expect(dailyPlanCards[0]).toContain('title="社媒日常"')
    expect(dailyPlanCards[0]).not.toContain('每日计划')
  })

  it('has no card titled 每日计划', () => {
    expect(source).not.toMatch(/title="每日计划"/)
  })

  it('puts 社媒日常 first in the 内容生产 group', () => {
    const lines = source.split('\n')
    const header = lines.findIndex((l) => l.includes('内容生产</p>'))
    const firstCard = lines.findIndex((l, i) => i > header && l.includes('<ToolCard'))
    expect(lines[firstCard]).toContain('title="社媒日常"')
  })
})
