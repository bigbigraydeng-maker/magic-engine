// Live API regression tests — calls the real Jev/TypeSafe endpoint, no mock
// (kept in a separate file from fact-check.test.ts, which mocks
// '@/lib/jev/client' at module scope; a vitest module mock can't be reliably
// bypassed within the same file without breaking module caching).
//
// Requires TYPESAFE_API_KEY. Skipped (not failed) when the key isn't present
// in the environment running this suite, so CI without the key still passes;
// only a run with the key actually exercises the real model.
//
// The first case is the real 2026-09-20 incident: original/rewritten text
// pulled verbatim from production `seo_meta_log` (client c0000000-0000-0000-
// 0000-000000000000, slug china-visa-free-nz-2026) — not reconstructed from
// memory.

import { describe, expect, it } from 'vitest'
import { checkFactPreservation } from '../fact-check'

describe.skipIf(!process.env.TYPESAFE_API_KEY)('checkFactPreservation — live Jev regression cases', () => {
  it(
    '🔴 real 2026-09-20 incident (CTS china-visa-free-nz-2026): visa-free rewritten to imply application required → caught',
    async () => {
      const result = await checkFactPreservation(
        'China Visa-Free for New Zealand 2026: 30 Days, No Application Needed',
        'NZ passport holders can enter China visa-free for 30 days per visit until 31 Dec 2026 — no application, no embassy queue. Here are the exact documents to carry at the border, who qualifies, and the traps that catch New Zealanders out. Written by Baker Gu, CTS Tours NZ.',
        'China Visa for NZ Citizens 2026 | CTS',
        'Essential guide to China visas for NZ citizens in 2026. Learn requirements, application steps & timelines. Plan your trip with CTS Tours Auckland.',
      )
      expect(result.consistent).toBe(false)
    },
    15000,
  )

  it(
    'safe reword: same facts, different wording → not flagged',
    async () => {
      const result = await checkFactPreservation(
        'China Visa-Free for New Zealand 2026: 30 Days, No Application Needed',
        'NZ passport holders can enter China visa-free for 30 days per visit until 31 Dec 2026 — no application, no embassy queue.',
        'China Visa-Free Entry for NZ Travellers 2026: What You Need to Know',
        'New Zealand citizens can visit China for up to 30 days without applying for a visa, valid until the end of 2026 — no embassy visit required.',
      )
      expect(result.consistent).toBe(true)
    },
    15000,
  )

  it(
    'constructed price contradiction: free tour rewritten as a paid tour → caught',
    async () => {
      const result = await checkFactPreservation(
        'Free Auckland City Walking Tour with CTS Tours',
        'Join our complimentary 2-hour walking tour of Auckland city centre — no charge, just register your spot in advance.',
        'Auckland City Walking Tour with CTS Tours — $49pp',
        'Book our popular 2-hour walking tour of Auckland city centre for $49 per person, register your spot in advance.',
      )
      expect(result.consistent).toBe(false)
    },
    15000,
  )
})
