import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// User-facing pages must use the current entry names (内容日历 / 图片工厂 / 执行看板).
const ROOT = join(__dirname, '..')

const FILES = [
  'clients/[id]/brief/page.tsx',
  'clients/[id]/assets/page.tsx',
  'clients/[id]/production/[packageId]/page.tsx',
  'clients/[id]/execution/_components/SocialPlanSection.tsx',
  'clients/[id]/page.tsx',
]

describe('user-facing Launch Hub label is gone', () => {
  it.each(FILES)('%s does not show Launch Hub', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8')
    expect(src).not.toMatch(/Launch Hub/)
  })

  it('client home no longer mounts the factory review inbox', () => {
    const src = readFileSync(join(ROOT, 'clients/[id]/page.tsx'), 'utf8')
    expect(src).not.toMatch(/ReviewInbox/)
  })

  it('production package shortcut uses the content calendar name', () => {
    const src = readFileSync(join(ROOT, 'clients/[id]/production/[packageId]/page.tsx'), 'utf8')
    expect(src).toMatch(/label: '内容日历'/)
    expect(src).toMatch(/\/dashboard\/content\?client=/)
  })
})
