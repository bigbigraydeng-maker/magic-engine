import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Source-text guard: the Launch Hub (content), Visuals, Reels Studio and
// connector-settings pages must not expose any Publer / Publishing Hub entrance.
const ROOT = join(__dirname, '..')

const FILES = [
  'content/page.tsx',
  'visuals/page.tsx',
  'clients/[id]/_components/ReelsStudio.tsx',
  'clients/[id]/settings/_components/OtherDataSourcesPanel.tsx',
]

describe('Publer entrances are removed from dashboard pages', () => {
  it.each(FILES)('%s has no Publer / Publishing Hub wording or /api/publer calls', (file) => {
    const src = readFileSync(join(ROOT, file), 'utf8')
    expect(src).not.toMatch(/publer/i)
    expect(src).not.toMatch(/publishing hub/i)
  })
})
