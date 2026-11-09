'use client'

import { createContext, useContext } from 'react'

/**
 * Page-wide facts the deep components need for their wording, so they do not each read the snapshot.
 *
 * - channelsConnected: false while no channel (website, ads, email) reads the published catalog.
 *   The copy must then not claim that customers see anything.
 * - canPublish: false for people who can only ask Magic Engine to publish.
 * - canEditSite: true only for Magic Engine admins (ratings, search settings, tags, FAQs, new image addresses).
 * - siteDomain: the client's registered website domain; the only host a site-relative image path is joined to.
 * - imagePool: image addresses already used in this client's catalog (what staff may pick from).
 *
 * The workspace always provides real values. The default (used only by components rendered on
 * their own) is the most careful one: promise nothing about channels, offer no publishing.
 */
export interface CatalogUi {
  channelsConnected: boolean
  canPublish: boolean
  canEditSite?: boolean
  siteDomain?: string | null
  imagePool?: string[]
}

const DEFAULT_UI: CatalogUi = { channelsConnected: false, canPublish: false }

const CatalogUiContext = createContext<CatalogUi>(DEFAULT_UI)

export const CatalogUiProvider = CatalogUiContext.Provider

export function useCatalogUi(): CatalogUi {
  return useContext(CatalogUiContext)
}

export function useChannelsConnected(): boolean {
  return useContext(CatalogUiContext).channelsConnected
}
