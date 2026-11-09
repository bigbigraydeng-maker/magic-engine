import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = [
  'src/app/meta-ads-ai/demo/page.tsx',
  'src/app/meta-ads-ai/[clientId]/screen.tsx',
  'src/app/meta-ads-ai/[clientId]/page.tsx',
  'src/app/meta-ads-ai/page.tsx',
  'src/lib/meta/ai/error-messages.ts',
  'src/app/data-deletion/page.tsx',
  'src/app/login/page.tsx',
  'src/app/dashboard/clients/[id]/layout.tsx',
  'src/app/dashboard/clients/[id]/_components/AdsCheckCard.tsx',
  'src/app/portal/register/page.tsx',
  'src/app/portal/register/register-form.tsx',
]

describe('customer-facing brand copy', () => {
  it.each(FILES)('does not expose the internal code name in %s', (path) => {
    const text = readFileSync(join(process.cwd(), path), 'utf8')
    expect(text).not.toContain('Magic Bridge')
  })
})
