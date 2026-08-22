import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function productionTypeScriptFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionTypeScriptFiles(full)
    }
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : []
  })
}

describe('Social local-proof architecture', () => {
  it('keeps the provider contract side-effect free and provider-neutral', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/social/social-publishing-provider.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/@\/lib\/(publer|meta|supabase)/)
    expect(source).not.toMatch(/process\.env|\bfetch\s*\(/)
  })

  it('keeps the local capability out of every production composition root', () => {
    const definition = path.join(
      process.cwd(),
      'src/lib/capabilities/social-schedule-approved-post/index.ts',
    )
    const importers = productionTypeScriptFiles(path.join(process.cwd(), 'src'))
      .filter((file) => file !== definition)
      .filter((file) => fs.readFileSync(file, 'utf8')
        .includes('createLocalSocialScheduleCapability'))
    expect(importers).toEqual([])
  })

  it('adds no real-provider adapter or harness', () => {
    expect(fs.existsSync(path.join(
      process.cwd(), 'src/lib/social/publer-social-adapter.ts',
    ))).toBe(false)
    expect(fs.existsSync(path.join(
      process.cwd(), 'src/lib/social/__tests__/meta-social-provider.contract.integration.test.ts',
    ))).toBe(false)
  })
})
