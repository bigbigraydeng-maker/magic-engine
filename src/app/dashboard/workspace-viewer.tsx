'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { type ViewerFacts } from '@/lib/auth/home-entries'

const CLIENT_FACTS: ViewerFacts = {
  role: 'client-viewer',
  allowedClientId: null,
  exactGlobalAdmin: false,
}

const ViewerContext = createContext<ViewerFacts>(CLIENT_FACTS)

export function WorkspaceViewerProvider({
  facts,
  children,
}: {
  facts: ViewerFacts
  children: ReactNode
}) {
  return <ViewerContext.Provider value={facts}>{children}</ViewerContext.Provider>
}

export function useWorkspaceViewer(): ViewerFacts {
  return useContext(ViewerContext)
}
