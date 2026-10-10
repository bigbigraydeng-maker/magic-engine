'use client'

import { createContext, useContext } from 'react'

/**
 * Page-wide facts the deep components need for their wording, so they do not each read the snapshot.
 *
 * - channelsConnected: false while no channel (website, ads, email) reads the published catalog.
 *   The copy must then not claim that customers see anything.
 * - canPublish: false for people who can only ask Magic Engine to publish.
 *
 * The workspace always provides real values. The default (used only by components rendered on
 * their own, e.g. in unit tests) keeps the original wording.
 */
export interface CatalogUi {
  channelsConnected: boolean
  canPublish: boolean
}

const DEFAULT_UI: CatalogUi = { channelsConnected: true, canPublish: true }

const CatalogUiContext = createContext<CatalogUi>(DEFAULT_UI)

export const CatalogUiProvider = CatalogUiContext.Provider

export function useCatalogUi(): CatalogUi {
  return useContext(CatalogUiContext)
}

export function useChannelsConnected(): boolean {
  return useContext(CatalogUiContext).channelsConnected
}
