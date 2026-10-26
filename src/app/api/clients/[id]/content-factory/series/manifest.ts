import 'server-only'
import cts from '../../../../../../../config/clients/cts/documentary-series.json'
import type { Episode } from '@/app/dashboard/clients/[id]/content-factory/series/types'

type Manifest = { client_id: string; name: string; voice: string; style: string; seasonalNote: string; cadence: string; episodes: Episode[] }
// Client-specific editorial facts belong in configuration, never platform defaults.
const episodes: Episode[] = cts.episodes.map(episode => {
  const status = episode.cover.status
  if (status !== 'approved' && status !== 'draft') throw new Error('Invalid configured cover status')
  return { ...episode, cover: { ...episode.cover, status } }
})
const manifests: Manifest[] = [{ ...cts, episodes }]
export function manifestFor(clientId: string): Manifest | null {
  return manifests.find(m => m.client_id === clientId) ?? null
}
