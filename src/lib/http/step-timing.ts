/**
 * Per-step wall-clock timing for a request, sent as a `Server-Timing` header so the real server time can be
 * read in browser DevTools (or `PerformanceResourceTiming.serverTiming`). Durations only: no ids, no personal data.
 * Steps are the time since the previous mark, so steps that run in parallel show up as one combined step.
 */
export interface StepTimer {
  step(name: string): void
  header(): string
}

export function createStepTimer(now: () => number = () => performance.now()): StepTimer {
  const start = now()
  let last = start
  const steps: Array<[string, number]> = []
  return {
    step(name: string): void {
      const t = now()
      steps.push([name, Math.max(0, t - last)])
      last = t
    },
    header(): string {
      const parts = steps.map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
      parts.push(`total;dur=${Math.max(0, now() - start).toFixed(1)}`)
      return parts.join(', ')
    },
  }
}
