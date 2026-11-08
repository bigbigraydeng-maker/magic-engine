/** Same ad account, whether or not the stored id has an `act_` prefix. */

function bareAccount(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

export function registeredAccountMatch(holdAccount: string, registered: readonly string[]): string | null {
  const wanted = bareAccount(holdAccount)
  if (!wanted) return null
  return registered.find((id) => bareAccount(id) === wanted) ?? null
}
