import type { LoadSettingsResult } from './settings-store'

/**
 * What the panel should show for a client:
 *   ready        settings are valid and the switch is on
 *   disabled     settings are valid, switch is off
 *   invalid      a settings row exists but does not parse (sends are refused)
 *   unconfigured no settings row yet (legacy behaviour; templates cannot be sent)
 *   unreadable   the read itself failed
 */
export type FeatureState = 'ready' | 'disabled' | 'invalid' | 'unconfigured' | 'unreadable'

export function featureStateOf(load: LoadSettingsResult | null): FeatureState {
  if (load === null) return 'unreadable'
  if (load.kind === 'none') return 'unconfigured'
  if (load.kind === 'invalid') return 'invalid'
  return load.settings.enabled ? 'ready' : 'disabled'
}
