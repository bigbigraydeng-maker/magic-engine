import type { FactSource } from '../types'
import { publishedToursProvider } from './published-tours'
import type { FactProvider } from './types'

/** The provider for a template's fact source; 'none' (and anything unknown) has no provider. */
export function getProvider(source: FactSource): FactProvider | null {
  if (source === 'published_tours') return publishedToursProvider
  return null
}
