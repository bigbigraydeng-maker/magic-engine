/**
 * What requireCatalogAccess returns on success, for route tests that mock the access module.
 * The permission literals are written out here on purpose: these tests must not import the real
 * capability table (the access module is mocked in them).
 */
import type { CatalogPermissions } from '@/lib/tour-catalog/catalog-contract'

export const ADMIN_PERMISSIONS: CatalogPermissions = {
  view: true,
  edit: true,
  edit_site: true,
  assistant: true,
  request_publish: true,
  import: true,
  aliases: true,
  seed: true,
  publish: true,
  manage_members: true,
  manage_settings: true,
}

export const EDITOR_PERMISSIONS: CatalogPermissions = {
  view: true,
  edit: true,
  edit_site: false,
  assistant: true,
  request_publish: true,
  import: false,
  aliases: false,
  seed: false,
  publish: false,
  manage_members: false,
  manage_settings: false,
}

export function adminAccess(actor: string) {
  return {
    ok: true as const,
    actor,
    viewer: { email: actor, role: 'me_admin' as const },
    permissions: ADMIN_PERMISSIONS,
  }
}

export function editorAccess(actor: string) {
  return {
    ok: true as const,
    actor,
    viewer: { email: actor, role: 'client_editor' as const },
    permissions: EDITOR_PERMISSIONS,
  }
}
