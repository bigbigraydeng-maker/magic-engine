'use client'

import type {
  CatalogPermissions,
  CatalogSettings,
  ImageHostSuggestion,
} from '@/lib/tour-catalog/catalog-contract'
import { CatalogMembersCard } from './CatalogMembersCard'
import { CatalogBrandSettingsCard } from './CatalogBrandSettingsCard'
import { CatalogImageHostsCard } from './CatalogImageHostsCard'
import { CatalogSiteDiffCard } from './CatalogSiteDiffCard'

export function CatalogSettingsPanel(props: {
  clientId: string
  settings: CatalogSettings
  permissions: Pick<CatalogPermissions, 'manage_members' | 'manage_settings'>
  /** Image hosts in use that are not on the allow-list yet (admins only). */
  imageHostSuggestions?: ImageHostSuggestion[]
  onSaved: () => void
}): JSX.Element {
  const { clientId, settings, permissions, onSaved } = props
  return (
    <div className="space-y-5">
      {permissions.manage_members ? <CatalogMembersCard clientId={clientId} /> : null}
      {permissions.manage_settings ? (
        <>
          <CatalogBrandSettingsCard clientId={clientId} settings={settings} onSaved={onSaved} />
          <CatalogImageHostsCard
            clientId={clientId}
            settings={settings}
            suggestions={props.imageHostSuggestions}
            onSaved={onSaved}
          />
          <CatalogSiteDiffCard clientId={clientId} />
        </>
      ) : null}
    </div>
  )
}
