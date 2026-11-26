// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TRIGGERED_SEND_SWITCHES, isLiveFor, readLiveSwitches } from '../live-switch'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OTHER = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

function env(values: Record<string, string>) {
  return (name: string): string | undefined => values[name]
}

describe('live switch', () => {
  it('is on only when the flag is exactly "true" and the client is on the list', () => {
    const switches = readLiveSwitches(TRIGGERED_SEND_SWITCHES, env({ TRIGGERED_SEND_LIVE: 'true', TRIGGERED_SEND_CLIENTS: ` ${CTS.toUpperCase()} , ` }))
    expect(switches).toEqual({ live: true, clientIds: [CTS] })
    expect(isLiveFor(switches, CTS)).toBe(true)
    expect(isLiveFor(switches, OTHER)).toBe(false)
  })

  it('anything but the exact string "true" leaves it off (a typo never arms a sender)', () => {
    for (const value of ['TRUE', 'True', '1', ' true', 'true ', 'yes', 'on', '']) {
      const switches = readLiveSwitches(TRIGGERED_SEND_SWITCHES, env({ TRIGGERED_SEND_LIVE: value, TRIGGERED_SEND_CLIENTS: CTS }))
      expect(isLiveFor(switches, CTS), JSON.stringify(value)).toBe(false)
    }
  })

  it('an empty or missing allow-list arms nobody, even with the flag on', () => {
    expect(isLiveFor(readLiveSwitches(TRIGGERED_SEND_SWITCHES, env({ TRIGGERED_SEND_LIVE: 'true' })), CTS)).toBe(false)
    expect(isLiveFor(readLiveSwitches(TRIGGERED_SEND_SWITCHES, env({ TRIGGERED_SEND_LIVE: 'true', TRIGGERED_SEND_CLIENTS: ' , ' })), CTS)).toBe(false)
  })

  it('missing variables mean off', () => {
    expect(readLiveSwitches(TRIGGERED_SEND_SWITCHES, env({}))).toEqual({ live: false, clientIds: [] })
  })

  it('reads the triggered-send variable names', () => {
    expect(TRIGGERED_SEND_SWITCHES).toEqual({ live: 'TRIGGERED_SEND_LIVE', clients: 'TRIGGERED_SEND_CLIENTS' })
  })
})
