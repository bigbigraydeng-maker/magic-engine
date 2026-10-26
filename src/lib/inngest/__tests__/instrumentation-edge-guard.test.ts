import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(path.resolve(__dirname, '../../../instrumentation.ts'), 'utf8')

// Next also builds src/instrumentation.ts for the Edge runtime. If the boot sync can be reached there, the bundler follows
// it to crypto / net / dns, the Edge build fails and nothing deploys. Pull requests no longer run a full build, so this
// is the automatic guard for that mistake.
describe('src/instrumentation.ts keeps Node-only code out of the Edge build', () => {
  it('imports the boot sync only inside an "is nodejs" branch', () => {
    expect(source).toMatch(/if \(process\.env\.NEXT_RUNTIME === 'nodejs'\) \{[\s\S]*await import\('@\/lib\/inngest\/sync-on-boot'\)/)
  })

  it('does not use the early-return form, which still lets the bundler follow the import', () => {
    expect(source).not.toMatch(/NEXT_RUNTIME !== 'nodejs'/)
  })

  it('has no static import, which would be followed in every runtime', () => {
    expect(source).not.toMatch(/^import /m)
  })
})
