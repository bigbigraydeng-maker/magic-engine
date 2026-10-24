const inflight = new Set<Promise<void>>()

/** Hold the promise so a returned HTTP response does not drop the work. */
export function retainBackground(work: Promise<void>): void {
  inflight.add(work)
  void work.finally(() => {
    inflight.delete(work)
  })
}

export function whenBackgroundIdle(): Promise<void> {
  return Promise.all(Array.from(inflight)).then(() => undefined)
}
