/**
 * Who may press a P0 confirmation card.
 * OPC: any client. FDE: only the client they are responsible for.
 * Agent identities and the client's own staff can never press it.
 */

import { ConfirmationCardError } from './errors'

export type CardClicker =
  | { readonly kind: 'opc'; readonly email: string }
  | { readonly kind: 'fde'; readonly email: string; readonly clientId: string }
  | { readonly kind: 'client_staff'; readonly email: string }
  | { readonly kind: 'agent'; readonly email: string | null }
  | { readonly kind: 'unknown' }

export interface ClickGrant {
  readonly email: string
  readonly role: 'OPC' | 'FDE'
}

const DENIED = '只有负责人和这位客户自己的执行同事能点。代理人和客户员工不能点。'

export function assertMayClick(clicker: CardClicker, clientId: string): ClickGrant {
  if (clicker.kind === 'opc') return { email: clicker.email, role: 'OPC' }
  if (clicker.kind === 'fde' && clicker.clientId === clientId) {
    return { email: clicker.email, role: 'FDE' }
  }
  throw new ConfirmationCardError('forbidden', DENIED)
}

/** Agents may ask for a card. They still cannot press it. */
export function assertMayIssue(clicker: CardClicker, clientId: string): void {
  if (clicker.kind === 'agent') return
  assertMayClick(clicker, clientId)
}

export function clickerFromSession(args: {
  email: string
  role: 'admin' | 'client-viewer'
  allowedClientId: string | null
  clientId: string
  agentMarked: boolean
}): CardClicker {
  const email = args.email.trim().toLowerCase()
  if (args.agentMarked) return { kind: 'agent', email: email || null }
  if (!email) return { kind: 'unknown' }
  if (args.role !== 'admin') return { kind: 'client_staff', email }
  if (args.allowedClientId === null) return { kind: 'opc', email }
  if (args.allowedClientId === args.clientId) return { kind: 'fde', email, clientId: args.clientId }
  return { kind: 'unknown' }
}

export function buttonsFor(clicker: CardClicker, clientId: string, hardBlock: string | null, waiting: boolean): {
  confirmEnabled: boolean
  declineEnabled: boolean
  blockedReason: string | null
} {
  let grant: ClickGrant | null = null
  try {
    grant = assertMayClick(clicker, clientId)
  } catch (error) {
    if (!(error instanceof ConfirmationCardError)) throw error
  }
  if (!waiting || !grant) {
    return {
      confirmEnabled: false,
      declineEnabled: false,
      blockedReason: grant ? null : DENIED,
    }
  }
  if (hardBlock) {
    return { confirmEnabled: false, declineEnabled: true, blockedReason: hardBlock }
  }
  return { confirmEnabled: true, declineEnabled: true, blockedReason: null }
}
