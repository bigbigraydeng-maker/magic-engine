import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The client page is far too large to render in a unit test; check the door-card source instead.
const source = readFileSync(join(__dirname, '..', 'page.tsx'), 'utf8')
const lines = source.split('\n')

describe('client page 社媒 door — one entry, no 每日计划 wording', () => {
  it('has exactly one door whose main link goes to the overview tab of daily-plan', () => {
    const doors = lines.filter((l) => l.includes('href={`/dashboard/clients/${clientId}/daily-plan?tab=overview`}'))
    expect(doors).toHaveLength(1)
  })

  it('no user-facing 每日计划 wording is left on the page', () => {
    const wording = lines.filter((l) => l.includes('每日计划') && !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    expect(wording).toEqual([])
  })

  it('puts 社媒 first in the 内容生产 group', () => {
    const header = lines.findIndex((l) => l.includes('内容生产</p>'))
    const firstCard = lines.findIndex((l, i) => i > header && (l.includes('<ToolCard') || l.includes('<ToolDoorCard')))
    expect(lines[firstCard]).toContain('<ToolDoorCard')
    const titleLine = lines.slice(firstCard, firstCard + 6).find((l) => l.includes('title='))
    expect(titleLine).toContain('社媒')
  })
})
