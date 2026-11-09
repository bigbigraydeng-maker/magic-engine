import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(process.cwd(), 'src/lib/ads-go-live')

function sources(): string {
  return readdirSync(ROOT)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => readFileSync(join(ROOT, name), 'utf8'))
    .join('\n')
}

describe('go-live library stays off the ad network', () => {
  it('does not import the publisher, the token manager, or the ad graph', () => {
    const text = sources()
    expect(text).not.toMatch(/ad-publisher|token-manager|graph\.facebook/)
    expect(text).not.toMatch(/approveDraft|activatePublished|pausePublished/)
  })

  it('keeps the issue route from spending', () => {
    const route = readFileSync(
      join(process.cwd(), 'src/app/api/clients/[id]/go-live-cards/route.ts'),
      'utf8',
    )
    expect(route).not.toMatch(/approveDraft|ad-publisher|getMetaTokenForClient|executeConfirmedGoLive/)
  })

  it('mounts the shared card on the approval page', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/dashboard/ad-approval/page.tsx'), 'utf8')
    expect(page).toContain('GoLiveCardPanel')
    expect(page).not.toContain('ApproveButtons')
    expect(page).not.toContain('/api/ad-approval')
  })
})
