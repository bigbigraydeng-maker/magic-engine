import { afterEach, describe, expect, it, vi } from 'vitest'

import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import type { ConfirmationCardView } from '@/lib/confirmation-card/view'
import { InMemoryLiteStore } from '@/lib/social/story-lite/in-memory-store'
import { authorizeLitePack, buildLitePreview, type LiteServicePorts } from '@/lib/social/story-lite/service'
import type { NewLiteItem } from '@/lib/social/story-lite/types'

import { cadenceFromConfig, cadenceSentence, DEFAULT_WEEKLY_PACK_CADENCE, isWeekday, targetWeek } from '../cadence'
import { storyAuthorizeLifetime } from '../lifetime'
import { buildWeekPackFacts, scopeHasDigest, scopeLine } from '../facts'
import { manifestDigest } from '../fingerprint'
import { confirmWeekPack, declineWeekPack, openWeekPack, revokeWeekPack, type WeekPackPorts } from '../flow'
import { loadWeekPackManifest } from '../load'
import { readHeldEvidence, recordUnpublishedOnCard, unpublishedFailures } from '../persist-held'
import { createWeekPackPorts } from '../wire'
import { buildManifest, emptyStory, selectReels, unreadStory, type ReelInput } from '../manifest'
import { promoteReelGated } from '../promote-guard'
import { reelGoPublicOnApproveEnabled, weeklyPackApprovalEnabled } from '../switches'
import { describeManifest, displayScope, toWeekPackPage } from '../view'
import type { WeekPackManifest } from '../types'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const OPC: CardClicker = { kind: 'opc', email: 'admin@example.com' }
const AGENT: CardClicker = { kind: 'agent', email: 'agent@example.com' }
const FRIDAY_NZ = new Date('2026-11-05T21:00:00.000Z')
const MONDAY_NZ = new Date('2026-11-08T21:00:00.000Z')

function storyItem(id: string, slot: string): NewLiteItem {
  return {
    item_id: id, channel: 'facebook_story', slot_at: slot, media_kind: 'image',
    media_url: 'https://example.com/a.png', media_sha256: 'a'.repeat(64), text_line: `line ${id}`,
    account_id: 'page-fixture', source_ref: 'https://example.com/p',
  }
}

function sample(overrides: Partial<WeekPackManifest> = {}): WeekPackManifest {
  return {
    ...buildManifest({
      clientId: CLIENT,
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      assembledAt: '2026-11-06T00:00:00.000Z',
      story: {
        read_state: 'ok', pack_id: 'pack-1', title: '下一周', state: 'DRAFT',
        content_hash: 'c'.repeat(64),
        items: [{
          item_id: 'item-1', channel: 'facebook_story', slot_at: '2026-11-09T19:30:00.000Z',
          fingerprint: 'b'.repeat(64), status: 'PENDING', in_target_week: true,
        }],
      },
      reels: { read_state: 'ok', truncated: false, items: [] },
    }),
    ...overrides,
  }
}

function viewCard(fingerprint: string, status: ConfirmationCardView['status']): ConfirmationCardView {
  return {
    runId: 'run-1', expectedDecisionId: 'dec-1', fingerprint,
    what: '同意按清单发布下周的 Story 和 Reel。改过的会单独拦住。',
    account: '示例客户', amount: '不涉及广告花费',
    date: '2026-11-09 至 2026-11-15（新西兰，周一至周日）',
    scope: '下周 Story 1 条、Reel 0 条，图文尚未接入。',
    expiresLabel: '请在时间内点。', status, statusLine: '等你点',
    confirmEnabled: status === 'waiting', declineEnabled: status === 'waiting', blockedReason: null,
  }
}

function ports(manifest: WeekPackManifest, hooks?: {
  authorize?: WeekPackPorts['authorizeStory']
  promote?: WeekPackPorts['promoteReel']
  revoke?: WeekPackPorts['revokeStory']
  decide?: WeekPackPorts['decideCard']
  issue?: WeekPackPorts['issueCard']
}): { ports: WeekPackPorts; authorize: ReturnType<typeof vi.fn>; promote: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn>; decide: ReturnType<typeof vi.fn>; issue: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> } {
  const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: false })
  const authorize = vi.fn(hooks?.authorize ?? (async () => ({ ok: true as const, code: 'story_authorized' as const })))
  const promote = vi.fn(hooks?.promote ?? (async () => { throw new Error('promote must not run') }))
  const revoke = vi.fn(hooks?.revoke ?? (async () => ({ ok: true as const, code: 'revoked' as const, sent: 1, inFlight: 0, summaryAvailable: true })))
  const decide = vi.fn(hooks?.decide ?? (async (input: { fingerprint: string; resolution: 'confirm' | 'decline' }) => (
    viewCard(input.fingerprint, input.resolution === 'confirm' ? 'confirmed' : 'declined')
  )))
  const issue = vi.fn(hooks?.issue ?? (async () => viewCard(built.fingerprint, 'waiting')))
  const record = vi.fn(async () => 'saved' as const)
  return {
    authorize, promote, revoke, decide, issue, record,
    ports: {
      loadManifest: async () => manifest,
      accountLabel: async () => '示例客户',
      cadence: () => DEFAULT_WEEKLY_PACK_CADENCE,
      reelGoPublic: false,
      issueCard: issue,
      decideCard: decide,
      authorizeStory: authorize,
      revokeStory: revoke,
      promoteReel: promote,
      recordUnpublished: record,
    },
  }
}

describe('switches and cadence', () => {
  it('stays off unless the value is exactly true, and the default week is Thu / Fri / Mon', () => {
    expect(weeklyPackApprovalEnabled({})).toBe(false)
    expect(weeklyPackApprovalEnabled({ WEEKLY_PACK_APPROVAL_ENABLED: 'TRUE' })).toBe(false)
    expect(weeklyPackApprovalEnabled({ WEEKLY_PACK_APPROVAL_ENABLED: 'true' })).toBe(true)
    expect(reelGoPublicOnApproveEnabled({})).toBe(false)
    expect(DEFAULT_WEEKLY_PACK_CADENCE).toEqual({ draftWeekday: 4, approveWeekday: 5, publishWeekday: 1 })
    expect(cadenceSentence(DEFAULT_WEEKLY_PACK_CADENCE)).toContain('周四出草稿，周五批，周一起按计划发')
    expect(JSON.stringify(DEFAULT_WEEKLY_PACK_CADENCE)).not.toMatch(/cts|client/i)
  })

  it('uses the coming Monday from Friday, and the Monday after next from Monday', () => {
    expect(targetWeek(FRIDAY_NZ)).toEqual({ weekStart: '2026-11-09', weekEnd: '2026-11-15' })
    expect(targetWeek(MONDAY_NZ)).toEqual({ weekStart: '2026-11-16', weekEnd: '2026-11-22' })
    expect(isWeekday(FRIDAY_NZ, 5)).toBe(true)
  })

  it('lets a client override one day and keeps the others on the default', () => {
    const cadence = cadenceFromConfig({ weekly_pack: { approve_weekday: 3, draft_weekday: 9 } })
    expect(cadence.approveWeekday).toBe(3)
    expect(cadence.draftWeekday).toBe(4)
    expect(cadence.publishWeekday).toBe(1)
  })
})

describe('manifest', () => {
  it('says unreadable instead of zero, and a later row changes the digest', () => {
    const unread = sample({ story: unreadStory() })
    const empty = sample({ story: emptyStory() })
    expect(scopeLine(unread, manifestDigest(unread))).toContain('Story 读不到')
    expect(scopeLine(empty, manifestDigest(empty))).toContain('Story 没有')
    expect(manifestDigest(unread)).not.toBe(manifestDigest(empty))
    const changed = sample()
    changed.story.items[0] = { ...changed.story.items[0], fingerprint: 'd'.repeat(64) }
    expect(manifestDigest(changed)).not.toBe(manifestDigest(sample()))
  })

  it('keeps reviewed drafts, drops already-public rows, and does not invent a publish day', () => {
    const rows: ReelInput[] = [
      reel('in-week', 'approved', null, '2026-11-10'),
      reel('undated', 'approved', null, null),
      reel('public', 'published', 'PUBLISHED', '2026-11-10'),
      reel('other-week', 'approved', null, '2026-12-01'),
      reel('waiting', 'in_review', null, '2026-11-10'),
    ]
    const picked = selectReels(rows, '2026-11-09', '2026-11-15')
    expect(picked.map((item) => item.work_order_id)).toEqual(['in-week', 'undated'])
    expect(picked[1].date_state).toBe('undated')
    expect(picked[1].scheduled_at_iso).toBeNull()
  })
})

describe('orchestration', () => {
  it('does not authorise or promote while the switch is off', async () => {
    const manifest = sample()
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: false })
    const fake = ports(manifest)
    const opened = await openWeekPack({ enabled: false, clientId: CLIENT, ports: fake.ports })
    expect(opened.card).toBeNull()
    expect(fake.issue).not.toHaveBeenCalled()
    const confirmed = await confirmWeekPack({
      enabled: false, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: built.fingerprint, tokens: new Map([['reel-1', 'token-token']]), ports: fake.ports,
    })
    expect(confirmed.httpStatus).toBe(409)
    expect(fake.authorize).not.toHaveBeenCalled()
    expect(fake.promote).not.toHaveBeenCalled()
    expect(fake.decide).not.toHaveBeenCalled()
  })

  it('refuses an agent and a changed list before any authorise call', async () => {
    const manifest = sample()
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: false })
    const fake = ports(manifest)
    const agent = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: AGENT, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: built.fingerprint, tokens: new Map(), ports: fake.ports,
    })
    expect(agent.httpStatus).toBe(403)
    expect(fake.authorize).not.toHaveBeenCalled()
    const stale = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: 'e'.repeat(64), tokens: new Map(), ports: fake.ports,
    })
    expect(stale.httpStatus).toBe(409)
    expect(stale.message).toContain('清单变了')
    expect(fake.decide).not.toHaveBeenCalled()
    expect(fake.authorize).not.toHaveBeenCalled()
  })

  it('keeps a successful Story authorisation when a Reel step fails', async () => {
    const manifest = sample({
      reels: {
        read_state: 'ok', truncated: false,
        items: [{
          work_order_id: '33333333-3333-4333-8333-333333333333', title: '一条视频',
          fingerprint: 'f'.repeat(64), scheduled_at_iso: '2026-11-10', video_state: 'DRAFT', date_state: 'in_week',
        }],
      },
    })
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: true })
    const fake = ports(manifest)
    fake.ports.reelGoPublic = true
    const result = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: built.fingerprint, tokens: new Map(), ports: fake.ports,
    })
    expect(result.receipt?.rolled_back).toBe(false)
    expect(result.receipt?.lines.map((line) => line.code)).toEqual([
      'story_authorized', 'skipped_not_wired', 'preview_required',
    ])
    expect(fake.promote).not.toHaveBeenCalled()
    expect(fake.revoke).not.toHaveBeenCalled()
    expect(fake.record).toHaveBeenCalledTimes(1)
    const recorded = fake.record.mock.calls[0][0].lines.map((line: { code: string }) => line.code)
    expect(recorded).toEqual(['preview_required'])
    expect(scopeHasDigest(built.facts.scope, built.digest)).toBe(true)
  })

  it('does not authorise anything when the person declines', async () => {
    const manifest = sample()
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: false })
    const fake = ports(manifest)
    const result = await declineWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: built.fingerprint, ports: fake.ports,
    })
    expect(result.receipt?.lines[0].code).toBe('declined_no_publish')
    expect(fake.authorize).not.toHaveBeenCalled()
    expect(fake.promote).not.toHaveBeenCalled()
  })

  it('stops unpublished Stories and does not pretend a Reel can be recalled', async () => {
    const manifest = sample()
    const fake = ports(manifest)
    const result = await revokeWeekPack({ enabled: true, clientId: CLIENT, clicker: OPC, ports: fake.ports })
    expect(result.receipt?.lines.map((line) => line.text).join(' ')).toContain('已经发出 1 条收不回')
    expect(result.receipt?.lines.map((line) => line.code)).toContain('reel_not_recalled')
    expect(fake.promote).not.toHaveBeenCalled()
  })

  it('does not roll back Story when promote fails', async () => {
    const reelId = '33333333-3333-4333-8333-333333333333'
    const manifest = sample({
      reels: {
        read_state: 'ok', truncated: false,
        items: [{
          work_order_id: reelId, title: '一条视频', fingerprint: 'f'.repeat(64),
          scheduled_at_iso: '2026-11-10', video_state: 'DRAFT', date_state: 'in_week',
        }],
      },
    })
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: true })
    const fake = ports(manifest, {
      promote: async () => ({ ok: false, code: 'reel_failed', text: '这条视频没能转公开。' }),
    })
    fake.ports.reelGoPublic = true
    const result = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: built.fingerprint,
      tokens: new Map([[reelId, 'preview-token']]),
      ports: fake.ports,
    })
    expect(fake.authorize).toHaveBeenCalledTimes(1)
    expect(fake.revoke).not.toHaveBeenCalled()
    expect(result.receipt?.rolled_back).toBe(false)
    expect(result.receipt?.lines.find((line) => line.kind === 'story')?.ok).toBe(true)
    expect(result.receipt?.lines.find((line) => line.code === 'reel_failed')?.ok).toBe(false)
    expect(fake.record.mock.calls[0][0].lines.map((line: { code: string }) => line.code)).toEqual(['reel_failed'])
  })

  it('keeps the Story authorisation when the reminder cannot be saved', async () => {
    const manifest = sample()
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: false })
    const fake = ports(manifest, {
      authorize: async () => ({ ok: false, code: 'story_forbidden' }),
    })
    fake.record.mockResolvedValue('failed')
    const result = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: built.fingerprint, tokens: new Map(), ports: fake.ports,
    })
    expect(fake.revoke).not.toHaveBeenCalled()
    expect(result.receipt?.rolled_back).toBe(false)
    expect(result.receipt?.lines.map((line) => line.code)).toContain('story_forbidden')
    expect(result.receipt?.lines.map((line) => line.code)).toContain('reminder_not_saved')
    expect(fake.record.mock.calls[0][0].lines.map((line: { code: string }) => line.code)).toEqual(['story_forbidden'])
  })

  it('does not authorise when the card itself rejects the click', async () => {
    const manifest = sample({ story: unreadStory() })
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: false })
    const fake = ports(manifest, {
      decide: async () => { throw new ConfirmationCardError('hard_check', '清单读不到') },
    })
    const result = await confirmWeekPack({
      enabled: true, clientId: CLIENT, clicker: OPC, runId: 'run-1', expectedDecisionId: 'dec-1',
      fingerprint: built.fingerprint, tokens: new Map(), ports: fake.ports,
    })
    expect(result.httpStatus).toBe(409)
    expect(fake.authorize).not.toHaveBeenCalled()
  })
})

describe('promote guard and page copy', () => {
  const previous = process.env.ADMIN_EMAILS
  afterEach(() => {
    if (previous === undefined) delete process.env.ADMIN_EMAILS
    else process.env.ADMIN_EMAILS = previous
  })

  it('does not call promote unless the switch is on and the person is a global admin', async () => {
    const run = vi.fn(async () => ({ ok: true as const, code: 'reel_promoted' as const, text: '公开了' }))
    await promoteReelGated({ enabled: false, allowedClientId: null, email: 'admin@example.com', run })
    expect(run).not.toHaveBeenCalled()
    process.env.ADMIN_EMAILS = 'admin@example.com'
    await promoteReelGated({ enabled: true, allowedClientId: CLIENT, email: 'admin@example.com', run })
    expect(run).not.toHaveBeenCalled()
    const allowed = await promoteReelGated({ enabled: true, allowedClientId: null, email: 'admin@example.com', run })
    expect(allowed.code).toBe('reel_promoted')
  })

  it('shows plain sentences and hides the check code', () => {
    const manifest = sample()
    const built = buildWeekPackFacts({ manifest, accountLabel: '示例客户', reelGoPublic: false })
    const page = toWeekPackPage({
      enabled: false, reelGoPublic: false, cadence: DEFAULT_WEEKLY_PACK_CADENCE,
      manifest, card: viewCard(built.fingerprint, 'waiting'), message: null, receipt: null,
    })
    const visible = [page.headline, page.posts_line, page.cadence_line, page.card?.display_scope, ...page.lines, ...describeManifest(manifest)].join('\n')
    expect(visible).toContain('尚未接入')
    expect(visible).not.toMatch(/[{}[\]]|核对码|fingerprint|hash/i)
    expect(displayScope(built.facts.scope)).not.toContain(built.digest)
    expect(built.facts.scope.length).toBeLessThanOrEqual(180)
  })
})

describe('load', () => {
  it('reads this client only and reports an unreadable Reel list instead of zero', async () => {
    const store = new InMemoryLiteStore()
    await store.insertPack(
      { id: 'pack-1', client_id: CLIENT, title: '下一周', now: new Date('2026-11-01T00:00:00.000Z') },
      [storyItem('item-1', '2026-11-09T19:30:00.000Z'), storyItem('item-2', '2026-10-01T19:30:00.000Z')],
    )
    await store.insertPack(
      { id: 'pack-2', client_id: OTHER, title: '别人的', now: new Date('2026-11-01T00:00:00.000Z') },
      [storyItem('item-9', '2026-11-09T19:30:00.000Z')],
    )
    const calls: unknown[] = []
    const db = {
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: (...args: unknown[]) => { calls.push(args); return chain },
          in: () => chain,
          order: () => chain,
          limit: async () => ({ data: null, error: { message: 'db down' } }),
        }
        return table === 'content_work_orders' ? chain : chain
      },
    }
    const portsForStore: LiteServicePorts = {
      store, adminEmails: { has: () => true }, checkFile: async () => 'OK', sendEvent: async () => {},
    }
    const manifest = await loadWeekPackManifest({
      ports: portsForStore, db: db as never, clientId: CLIENT, now: FRIDAY_NZ,
    })
    expect(manifest.story.pack_id).toBe('pack-1')
    expect(manifest.story.items).toHaveLength(2)
    expect(manifest.story.items.filter((item) => !item.in_target_week)).toHaveLength(1)
    expect(manifest.reels.read_state).toBe('unread')
    expect(manifest.reels.items).toHaveLength(0)
    expect(calls).toContainEqual(['client_id', CLIENT])
    expect(scopeLine(manifest, manifestDigest(manifest))).toContain('Reel 读不到')
  })

  it('authorises a Friday click that includes the following Sunday', async () => {
    const store = new InMemoryLiteStore()
    store.seedClient(CLIENT, { facebook_page_id: 'page-fixture', client_status: 'active' })
    const sunday = '2026-11-15T06:00:00.000Z'
    await store.insertPack(
      { id: 'pack-sun', client_id: CLIENT, title: '下一周', now: new Date('2026-11-01T00:00:00.000Z') },
      [storyItem('sun-1', sunday)],
    )
    const litePorts: LiteServicePorts = {
      store,
      adminEmails: { has: (email) => email === 'admin@example.com' },
      checkFile: async () => 'OK',
      sendEvent: async () => {},
    }
    const actor = { id: 'user-1', email: 'admin@example.com', allowedClientId: null }
    const lifetime = storyAuthorizeLifetime(FRIDAY_NZ)
    expect(lifetime).toBeGreaterThan(7)
    expect(lifetime).toBeLessThanOrEqual(14)
    const short = await buildLitePreview({
      ports: litePorts, packId: 'pack-sun', clientId: CLIENT, actor, now: FRIDAY_NZ, lifetimeDays: 7,
    })
    expect(short.ok).toBe(true)
    if (!short.ok) return
    expect(short.value.items[0]?.problems).toContain('SLOT_AFTER_EXPIRY')
    expect(short.value.can_authorize).toBe(false)
    const refused = await authorizeLitePack({
      ports: litePorts, packId: 'pack-sun', clientId: CLIENT, actor, confirm: true,
      lifetimeDays: 7, expectedContentHash: short.value.content_hash, now: FRIDAY_NZ,
    })
    expect(refused).toMatchObject({ ok: false, status: 422, error: 'PACK_NOT_AUTHORIZABLE' })

    const manifest = await loadWeekPackManifest({
      ports: litePorts,
      db: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) }) } as never,
      clientId: CLIENT,
      now: FRIDAY_NZ,
    })
    expect(manifest.story.content_hash).toBeTruthy()
    const wired = createWeekPackPorts({
      litePorts,
      db: {} as never,
      kernel: {} as never,
      clicker: OPC,
      actor,
      clientId: CLIENT,
      now: FRIDAY_NZ,
      env: {},
      settings: { label: '示例客户', config: null, configReadable: true },
    })
    const authorised = await wired.authorizeStory(manifest.story.pack_id ?? '', manifest.story.content_hash ?? '')
    expect(authorised).toEqual({ ok: true, code: 'story_authorized' })
  })

  it('writes only the unpublished lines onto the approved card and keeps other evidence', async () => {
    const lines = [
      { kind: 'story' as const, stable_id: 'pack-1', code: 'story_authorized', ok: true, text: 'Story 已授权。' },
      { kind: 'reel' as const, stable_id: '33333333-3333-4333-8333-333333333333', code: 'preview_required', ok: false, text: '有一条视频还没预览，没有公开。' },
    ]
    expect(unpublishedFailures(lines).map((line) => line.code)).toEqual(['preview_required'])
    const row = {
      id: 'run-1', client_id: CLIENT, action_key: 'governance.p0_confirmation', status: 'authorized',
      evidence: { keep: 'yes' },
    }
    let updates = 0
    const db = {
      from(table: string) {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => (table === 'action_runs' ? { data: row, error: null } : { data: null, error: { message: 'no' } }),
          update(patch: { evidence: Record<string, unknown> }) {
            updates += 1
            expect(patch.evidence.keep).toBe('yes')
            row.evidence = patch.evidence
            return chain
          },
          then(resolve: (value: { data: Array<{ id: string }>; error: null }) => void) {
            resolve({ data: [{ id: row.id }], error: null })
          },
        }
        return chain
      },
    }
    const saved = await recordUnpublishedOnCard(db as never, {
      runId: 'run-1', clientId: CLIENT, lines, now: FRIDAY_NZ,
    })
    expect(saved).toBe('saved')
    expect(updates).toBe(1)
    const read = readHeldEvidence(row.evidence)
    expect(read).not.toBe('none')
    expect(read).not.toBe('invalid')
    if (read === 'none' || read === 'invalid') return
    expect(read.map((line) => line.code)).toEqual(['preview_required'])
    expect(readHeldEvidence({ week_pack_unpublished: { items: 'nope' } })).toBe('invalid')
    expect(readHeldEvidence({})).toBe('none')
  })
})

function reel(
  id: string,
  status: string,
  video: 'DRAFT' | 'PUBLISHED' | null,
  publishOn: string | null,
): ReelInput {
  return {
    id, status, video_state: video, approved_at: video === 'DRAFT' ? '2026-11-01T00:00:00.000Z' : null,
    publish_on: publishOn, fingerprint: 'f'.repeat(64), title: id, asset_only: false,
  }
}
