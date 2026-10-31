import { describe, expect, it } from 'vitest'
import { featureStateOf } from '@/lib/crm/email-templates/feature-state'
import { settingsObj } from './fixtures'

describe('featureStateOf', () => {
  it('maps every settings situation to one state', () => {
    expect(featureStateOf(null)).toBe('unreadable')
    expect(featureStateOf({ kind: 'none' })).toBe('unconfigured')
    expect(featureStateOf({ kind: 'invalid', version: 2, errors: ['x'] })).toBe('invalid')
    expect(featureStateOf({ kind: 'ok', version: 1, settings: settingsObj({ enabled: false }) })).toBe('disabled')
    expect(featureStateOf({ kind: 'ok', version: 1, settings: settingsObj({ enabled: true }) })).toBe('ready')
  })
})
