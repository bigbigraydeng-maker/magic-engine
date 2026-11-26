/**
 * Who may ask for an ads confirmation card.
 * Same rule as the campaign pause card: a paid client may ask.
 * Only the owner or this client's operator may press the card.
 */

import type { ClientAccessResult } from '@/lib/auth/client-access'
import { clickerFromSession, type CardClicker } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'

type Access = Extract<ClientAccessResult, { ok: true }>

export function askerFromAccess(access: Access, clientId: string, agentMarked: boolean): CardClicker {
  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked,
  })
  if (clicker.kind === 'opc' || clicker.kind === 'fde' || clicker.kind === 'agent') return clicker
  if (clicker.kind === 'client_staff') return { kind: 'agent', email: clicker.email }
  throw new ConfirmationCardError('forbidden', '请先登录后再申请。')
}
