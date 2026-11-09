import type { ReactElement, ReactNode } from 'react'
import { render, type RenderResult } from '@testing-library/react'
import { CatalogUiProvider } from '../catalog-context'

const CONNECTED = { channelsConnected: true, canPublish: true, canEditSite: true }

function Connected(props: { children: ReactNode }): JSX.Element {
  return <CatalogUiProvider value={CONNECTED}>{props.children}</CatalogUiProvider>
}

/**
 * Render as an ME admin on a client whose channels read the catalog. The context default is the
 * careful one (not connected, cannot publish), so tests of the original wording ask for this.
 */
export function renderConnected(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: Connected })
}
