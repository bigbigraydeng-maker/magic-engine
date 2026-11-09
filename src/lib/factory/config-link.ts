export const FACTORY_CONFIG_SECTION = 'factory-config'

// The factory config lives in the 'content' tab of the client settings page
// and that section is collapsed by default, so the link must name both the
// tab and the section.
export function factoryConfigHref(clientId: string): string {
  return `/dashboard/clients/${encodeURIComponent(clientId)}/settings?tab=content&section=${FACTORY_CONFIG_SECTION}`
}
