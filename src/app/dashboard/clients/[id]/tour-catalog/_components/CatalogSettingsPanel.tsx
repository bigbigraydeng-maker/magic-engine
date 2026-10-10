'use client'

import type { CatalogPermissions, CatalogSettings } from '@/lib/tour-catalog/catalog-contract'
import { CatalogMembersCard } from './CatalogMembersCard'
import { CatalogBrandSettingsCard } from './CatalogBrandSettingsCard'

export function CatalogSettingsPanel(props: {
  clientId: string
  settings: CatalogSettings
  permissions: Pick<CatalogPermissions, 'manage_members' | 'manage_settings'>
  onSaved: () => void
}): JSX.Element {
  const { clientId, settings, permissions, onSaved } = props
  return (
    <div className="space-y-5">
      {permissions.manage_members ? <CatalogMembersCard clientId={clientId} /> : null}
      {permissions.manage_settings ? (
        <CatalogBrandSettingsCard clientId={clientId} settings={settings} onSaved={onSaved} />
      ) : null}
    </div>
  )
}
