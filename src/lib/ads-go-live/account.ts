/**
 * Which account name goes on the card.
 * Blade 11 may store a plain `accountLabel` on the paused draft. This module
 * only reads it. It never prints an account id.
 */

import { usableLabel } from './text'

export function chooseAccountLabel(
  draftLabel: string | null,
  bound: readonly (string | null)[] | null,
): { label: string } | { problem: string } {
  const fromDraft = usableLabel(draftLabel)
  if (fromDraft) return { label: fromDraft }
  if (bound === null || bound.length === 0) return { problem: '读不到广告账户' }
  if (bound.length > 1) return { problem: '草稿没写明是哪个广告账户' }
  const only = usableLabel(bound[0])
  if (!only) return { problem: '账户名称没记下' }
  return { label: only }
}
