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
}

export interface LayerRead {
  readonly name: string
  readonly status: string | null
}

export interface SettlePorts {
  claimAndActivate(): Promise<ActivateAttempt>
  activateOnly(): Promise<ActivateAttempt>
  readBack(): Promise<readonly LayerRead[] | null>
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

export async function settleGoLive(ports: SettlePorts): Promise<SettleResult> {
  const first = await ports.claimAndActivate()
  const seen = await ports.readBack()
  if (isLive(seen)) return { outcome: 'live', attempts: 1, readback: describeRead(seen) }
  if (!first.ok && !first.retryable) {
    return {
      outcome: 'held',
      readback: describeRead(seen),
      reason: publicFailure(first.error ?? '没有开，系列保持暂停。'),
      paused: false,
    }
  }
  const second = first.ok ? await ports.activateOnly() : await ports.claimAndActivate()
  const again = await ports.readBack()
  if (isLive(again)) return { outcome: 'live', attempts: 2, readback: describeRead(again) }
  const paused = await ports.keepPaused()
  return {
    outcome: 'held',
    readback: describeRead(again),
    reason: heldReason(paused, second),
    paused: true,
  }
}
