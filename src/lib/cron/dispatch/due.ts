import { bucketForSchedule, cronMatches, dispatchInstant } from './match'
import type { DispatchBucket, DispatchJob } from './types'

export function selectDue(
  jobs: readonly DispatchJob[],
  bucket: DispatchBucket,
  now: Date,
): DispatchJob[] {
  const at = dispatchInstant(now)
  return jobs.filter((job) => {
    return bucketForSchedule(job.schedule) === bucket && cronMatches(job.schedule, at)
  })
}
