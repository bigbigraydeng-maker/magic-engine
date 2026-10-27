import { describe, expect, it } from 'vitest'
import { assertMayClick, buttonsFor, clickerFromSession } from '../actor'
import { ConfirmationCardError } from '../errors'

const CLIENT = 'c11e0000-0000-4000-8000-00000000000a'
const OTHER = 'c11e0000-0000-4000-8000-00000000000b'

describe('who may press a confirmation card', () => {
  it('lets OPC press any client', () => {
    const grant = assertMayClick({ kind: 'opc', email: 'opc@example.com' }, CLIENT)
    expect(grant).toEqual({ email: 'opc@example.com', role: 'OPC' })
  })

  it('lets an FDE press only their own client', () => {
    expect(assertMayClick({ kind: 'fde', email: 'fde@example.com', clientId: CLIENT }, CLIENT).role).toBe('FDE')
    expect(() => assertMayClick({ kind: 'fde', email: 'fde@example.com', clientId: OTHER }, CLIENT)).toThrow(ConfirmationCardError)
  })

  it('never lets an agent or client staff press', () => {
    expect(() => assertMayClick({ kind: 'agent', email: null }, CLIENT)).toThrow(/不能点/)
    expect(() => assertMayClick({ kind: 'client_staff', email: 'staff@example.com' }, CLIENT)).toThrow(/不能点/)
  })

  it('reads OPC, FDE, staff, and a marked agent from the session', () => {
    expect(clickerFromSession({
      email: 'OPC@example.com', role: 'admin', allowedClientId: null, clientId: CLIENT, agentMarked: false,
    }).kind).toBe('opc')
    expect(clickerFromSession({
      email: 'fde@example.com', role: 'admin', allowedClientId: CLIENT, clientId: CLIENT, agentMarked: false,
    }).kind).toBe('fde')
    expect(clickerFromSession({
      email: 'staff@example.com', role: 'client-viewer', allowedClientId: CLIENT, clientId: CLIENT, agentMarked: false,
    }).kind).toBe('client_staff')
    expect(clickerFromSession({
      email: 'opc@example.com', role: 'admin', allowedClientId: null, clientId: CLIENT, agentMarked: true,
    }).kind).toBe('agent')
  })

  it('greys out confirm when a hard check is red, and still allows decline', () => {
    const buttons = buttonsFor({ kind: 'opc', email: 'opc@example.com' }, CLIENT, '账户读不到', true)
    expect(buttons.confirmEnabled).toBe(false)
    expect(buttons.declineEnabled).toBe(true)
    expect(buttons.blockedReason).toBe('账户读不到')
  })
})
