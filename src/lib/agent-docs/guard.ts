export function isGlobalAdmin(h: { get(name: string): string | null }): boolean {
  return h.get('x-user-role') === 'admin' && h.get('x-user-tier') === 'admin' && h.get('x-allowed-client-id') === null
}
