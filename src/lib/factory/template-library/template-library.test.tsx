import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LibraryPage } from '@/app/dashboard/template-library/_components/LibraryPage'
import { TEMPLATE_LIBRARY } from './catalog'
import { familyIdsFromCraftSource, templateIdFromReelFile, templateIdsFromReelFiles, templateSyncIssues } from './engine-sync'
import { libraryMediaPaths, templateLibraryView } from './present'

const REEL_DIR = join(process.cwd(), 'scripts/factory-worker/engines/remotion/src')
const CRAFT_FILE = join(REEL_DIR, 'styles/craft.ts')
const PUBLIC_ROOT = join(process.cwd(), 'public')

const BANNED = [/CTS/i, /Oztop/i, /Roman/i, /HBay/i, /East Inter/i, /华庭/]

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringsIn)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringsIn)
  return []
}

describe('template library catalog', () => {
  it('maps reel filenames to work-order ids', () => {
    expect(templateIdFromReelFile('ListReel.tsx')).toBe('list')
    expect(templateIdFromReelFile('DataCardReel.tsx')).toBe('datacard')
    expect(templateIdFromReelFile('CompareReel.tsx')).toBe('compare')
    expect(templateIdFromReelFile('notes.ts')).toBeNull()
  })

  it('stays in step with the reel files on disk', () => {
    const files = readdirSync(REEL_DIR).filter((name) => name.endsWith('Reel.tsx'))
    const engineIds = templateIdsFromReelFiles(files)
    expect(engineIds.length).toBeGreaterThan(0)
    expect(templateSyncIssues(engineIds, TEMPLATE_LIBRARY.templates)).toEqual([])
  })

  it('reads family ids when the style file is present', () => {
    expect(familyIdsFromCraftSource("export type FamilyId = 'flash' | 'minimal'\n")).toEqual(['flash', 'minimal'])
    expect(familyIdsFromCraftSource('no family line')).toBeNull()
    if (!existsSync(CRAFT_FILE)) return
    const ids = familyIdsFromCraftSource(readFileSync(CRAFT_FILE, 'utf8'))
    expect(ids).not.toBeNull()
    for (const id of ids ?? []) {
      expect(TEMPLATE_LIBRARY.families.some((family) => family.id === id)).toBe(true)
    }
  })

  it('gives every pack its own cut, text, rhythm and caption', () => {
    const signatures = TEMPLATE_LIBRARY.packs.map((pack) => Object.values(pack.difference).join('|'))
    expect(new Set(signatures).size).toBe(signatures.length)
    for (const pack of TEMPLATE_LIBRARY.packs) {
      expect(pack.difference.transition.length).toBeGreaterThan(0)
      expect(pack.difference.textMotion.length).toBeGreaterThan(0)
      expect(pack.difference.rhythm.length).toBeGreaterThan(0)
      expect(pack.difference.caption.length).toBeGreaterThan(0)
    }
  })

  it('keeps real client names out and points every preview at a file', () => {
    const text = stringsIn(TEMPLATE_LIBRARY).join('\n')
    for (const pattern of BANNED) expect(text).not.toMatch(pattern)
    expect(text).toContain('示例客户')
    const paths = [...new Set(libraryMediaPaths(TEMPLATE_LIBRARY))]
    expect(paths.length).toBeGreaterThan(10)
    for (const rel of paths) {
      expect(existsSync(join(PUBLIC_ROOT, rel.replace(/^\//, ''))), rel).toBe(true)
    }
  })
})

describe('template library page', () => {
  it('shows the three groups, every layout, and the four style differences', () => {
    render(<LibraryPage view={templateLibraryView()} />)
    expect(screen.getByRole('heading', { level: 1, name: '模板库' })).toBeTruthy()
    for (const name of ['平台通用', '行业', '企业品牌']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy()
    }
    for (const name of ['清单', '快切', '数据卡', '明信片', '氛围', '前后对比']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy()
    }
    for (const name of ['抖音快节奏', '高级极简', '温暖生活感', '纪录片质感', '促销冲击', '硬核数据']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy()
    }
    expect(screen.getAllByText('字幕').length).toBe(TEMPLATE_LIBRARY.packs.length)
    expect(screen.getAllByText('一个字一个字打出来').length).toBeGreaterThan(0)
    expect(screen.getAllByText('3 秒以上的长镜头').length).toBeGreaterThan(0)
    expect(screen.getAllByText('示例客户 A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('示例客户 B').length).toBeGreaterThan(0)
    expect(screen.getAllByText('现在就能用').length).toBe(5)
    expect(screen.queryByText(/\{/)).toBeNull()
  })
})
