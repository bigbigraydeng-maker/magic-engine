/**
 * Check one paused ad's destination, store the result, and ask a person
 * only when the check failed or could not be done.
 */

import type { CardClicker, CardFacts, ConfirmationCardView } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card'
import { receiptIsStale, TRACKING_RECEIPT_STALE_HOURS } from '@/lib/ads-tracking-preflight/receipt'
import { landingCardFacts } from './card'
import { destinationKey, readDestination, requestTarget, type Destination } from './destination'
import { readLandingPage, type PageRead } from './fetch-page'
import { landingHardCheck, landingHeadline } from './gate'
import { explainLines, judgeDestination, needsPerson } from './judge'
import { readStoredReceipt, receiptBody, type LandingReceipt } from './receipt'

export interface LandingView {
  readonly lines: readonly string[]
  readonly headline: string
  readonly card: ConfirmationCardView | null
  readonly clear: boolean
}

export interface LandingRunDeps {
  readonly now: Date
  readonly siteUrl: string | null
  readonly clicker: CardClicker
  readonly load: () => Promise<
    { ok: true; payload: Record<string, unknown> } | { ok: false; status: number; error: string }
  >
  readonly save: (
    payload: Record<string, unknown>,
    receipt: LandingReceipt,
  ) => Promise<{ ok: true } | { ok: false; status: number; error: string }>
  readonly confirmed: (receipt: LandingReceipt, accountLabel: string | null) => Promise<boolean>
  readonly issue: (facts: CardFacts) => Promise<ConfirmationCardView>
  readonly readPage?: (url: string) => Promise<PageRead>
}

export type LandingRunResult =
  | { readonly ok: true; readonly view: LandingView }
  | { readonly ok: false; readonly status: number; readonly error: string }

function present(receipt: LandingReceipt, confirmed: boolean, card: ConfirmationCardView | null, now: Date): LandingView {
  const check = landingHardCheck({ receipt, confirmed, now })
  return {
    lines: explainLines(receipt.items),
    headline: landingHeadline(check),
    card,
    clear: check.state === 'green',
  }
}

async function ask(
  deps: LandingRunDeps,
  draftId: string,
  accountLabel: string | null,
  receipt: LandingReceipt,
  confirmed: boolean,
): Promise<ConfirmationCardView | null> {
  if (!needsPerson(receipt.items) || confirmed) return null
  const facts = landingCardFacts(draftId, accountLabel, receipt)
  if (!facts) return null
  try {
    return await deps.issue(facts)
  } catch (error) {
    if (error instanceof ConfirmationCardError) return null
    throw error
  }
}

async function freshReceipt(deps: LandingRunDeps, dest: Destination): Promise<LandingReceipt> {
  const key = destinationKey(dest)
  const target = dest.kind === 'page' ? requestTarget(dest, deps.siteUrl) : null
  const read = target && target.ok
    ? await (deps.readPage ?? ((url: string) => readLandingPage(url, { siteUrl: deps.siteUrl ?? '' })))(target.url)
    : null
  return receiptBody(deps.now.toISOString(), key, judgeDestination(dest, target, read))
}

function reusable(payload: Record<string, unknown>, key: string, now: Date): LandingReceipt | null {
  const stored = readStoredReceipt(payload)
  if (!stored || stored.destinationKey !== key) return null
  if (receiptIsStale(stored.checkedAt, now, TRACKING_RECEIPT_STALE_HOURS)) return null
  return stored
}

export async function showLandingVerify(
  deps: Pick<LandingRunDeps, 'now' | 'load' | 'confirmed'>,
): Promise<LandingRunResult> {
  const loaded = await deps.load()
  if (!loaded.ok) return loaded
  const dest = readDestination(loaded.payload)
  const receipt = readStoredReceipt(loaded.payload)
  if (!dest || !receipt) {
    return {
      ok: true,
      view: { lines: [], headline: '还没有查过这条广告的去处。', card: null, clear: false },
    }
  }
  const confirmed = await deps.confirmed(receipt, dest.accountLabel)
  return { ok: true, view: present(receipt, confirmed, null, deps.now) }
}

export async function runLandingVerify(
  deps: LandingRunDeps,
  draftId: string,
  again: boolean,
): Promise<LandingRunResult> {
  const loaded = await deps.load()
  if (!loaded.ok) return loaded
  if (loaded.payload.status !== 'awaiting_approval') {
    return { ok: false, status: 409, error: '只有还在等点头的暂停广告才能核实落地页。' }
  }
  const dest = readDestination(loaded.payload)
  if (!dest) return { ok: false, status: 404, error: '这条草案没有落地页，也没有表单。' }
  const key = destinationKey(dest)
  const stored = again ? null : reusable(loaded.payload, key, deps.now)
  const receipt = stored ?? await freshReceipt(deps, dest)
  if (!stored) {
    const saved = await deps.save(loaded.payload, receipt)
    if (!saved.ok) return saved
  }
  const confirmed = await deps.confirmed(receipt, dest.accountLabel)
  const card = await ask(deps, draftId, dest.accountLabel, receipt, confirmed)
  return { ok: true, view: present(receipt, confirmed, card, deps.now) }
}
