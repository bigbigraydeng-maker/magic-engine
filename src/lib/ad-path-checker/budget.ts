/** Single-process safety backstop. Production also requires gateway-wide limits. */
export function createScanBudget() {
  let active = 0
  let minute = 0
  let count = 0
  const hosts = new Map<string, number>()
  return {
    acquire(host: string, now = Date.now()): (() => void) | null {
      for (const [key, time] of hosts) if (now - time >= 30_000) hosts.delete(key)
      if (now - minute >= 60_000) { minute = now; count = 0 }
      if (active >= 2 || count >= 12 || hosts.has(host)) return null
      active++
      count++
      hosts.set(host, now)
      let released = false
      return () => { if (!released) { active--; released = true } }
    },
  }
}

export const scanBudget = createScanBudget()
