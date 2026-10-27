/**
 * After the card is confirmed: turn the paused ad on, read it back,
 * retry the write once, otherwise leave it paused.
 * Ports are injected. This file does not call the ad network.
 */

import { publicFailure } from './text'

export interface ActivateAttempt {
  readonly ok: boolean
  readonly error?: string
  readonly retryable: boolean
  /** This caller still owns the activating claim after the attempt returns. */
  readonly holding?: boolean
}

export interface LayerRead {
  readonly name: string
  readonly status: string | null
}

export interface SettlePorts {
  claimAndActivate(): Promise<ActivateAttempt>
  activateOnly(): Promise<ActivateAttempt>
  readBack(): Promise<readonly LayerRead[] | null>
  /** Fresh check. False once this caller released the claim or someone else holds it. */
  stillOwns(): Promise<boolean>
  keepPaused(): Promise<{ ok: boolean; failed: string[] }>
}

export type SettleResult =
  | { readonly outcome: 'live'; readonly attempts: 1 | 2; readonly readback: string }
  | { readonly outcome: 'held'; readonly readback: string; readonly reason: string; readonly paused: boolean }

export function isLive(layers: readonly LayerRead[] | null): boolean {
  return !!layers && layers.length > 0 && layers.every((layer) => layer.status === 'ACTIVE')
}

export function describeRead(layers: readonly LayerRead[] | null): string {
  if (!layers || layers.length === 0) return '读回失败，不知道是不是在投'
  return layers.map((layer) => {
    if (layer.status === 'ACTIVE') return `${layer.name}在投`
    if (!layer.status) return `${layer.name}读不到`
    return `${layer.name}不是在投`
  }).join('，')
}

function heldReason(paused: { ok: boolean }, second: ActivateAttempt): string {
  const pauseNote = paused.ok
    ? '已经重试一次，读回仍不是在投，系列保持暂停。'
    : '已经重试一次，读回仍不是在投，而且补暂停没完全成功，要有人去广告后台核对。'
  if (second.ok || !second.error) return pauseNote
  return `${pauseNote}${publicFailure(second.error)}`
}

function live(attempts: 1 | 2, layers: readonly LayerRead[] | null): SettleResult {
  return { outcome: 'live', attempts, readback: describeRead(layers) }
}

function giveUp(layers: readonly LayerRead[] | null, reason: string): SettleResult {
  return { outcome: 'held', readback: describeRead(layers), reason: publicFailure(reason), paused: false }
}

function lostClaim(attempt: ActivateAttempt): boolean {
  return !attempt.ok && !attempt.retryable && attempt.holding !== true
}

/** A fresh claim only when the previous attempt already let the slot go. */
async function retry(ports: SettlePorts, first: ActivateAttempt): Promise<ActivateAttempt | null> {
  if (!first.ok && first.holding !== true) return ports.claimAndActivate()
  if (!(await ports.stillOwns())) return null
  return ports.activateOnly()
}

export async function settleGoLive(ports: SettlePorts): Promise<SettleResult> {
  const first = await ports.claimAndActivate()
  const seen = await ports.readBack()
  if (isLive(seen)) return live(1, seen)
  if (lostClaim(first)) return giveUp(seen, first.error ?? '没有开，系列保持暂停。')

  const second = await retry(ports, first)
  if (!second) return giveUp(seen, '占位已经交给别人，没有再改广告。')
  const again = await ports.readBack()
  if (isLive(again)) return live(2, again)
  // Lost the slot, or released it and someone else now holds activating.
  // Either way this request must not pause their ad.
  if ((lostClaim(second) && first.holding !== true && !first.ok) || !(await ports.stillOwns())) {
    return giveUp(again, second.error && lostClaim(second) ? second.error : '占位已经交给别人，没有再改广告。')
  }
  const paused = await ports.keepPaused()
  return {
    outcome: 'held',
    readback: describeRead(again),
    reason: heldReason(paused, second),
    paused: true,
  }
}
