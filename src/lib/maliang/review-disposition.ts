// Shared queue decision for 马良's nine-frame review.
// Both render routes call this so a pass, a reject, and a review that
// never finished mean the same thing. The check itself stays in render-check.ts.

import {
  mergeMaliangIntoSnapshot,
  type MaliangCheck,
  type MaliangStatus,
} from '@/lib/maliang/render-check'

/** Sibling of maliang_check on a work-order output. false = the machine did not finish a review. */
export const MACHINE_REVIEWED_KEY = 'machine_reviewed'

export const REMOTION_REVIEW_TIMEOUT_MS = 180_000

export interface ReviewDisposition {
  /** true = do not leave the piece in the human approve queue (a finished reject). */
  holdFromQueue: boolean
  /** false = the review did not finish; a person still has to look. */
  machineReviewed: boolean
}

export function dispositionOf(status: MaliangStatus): ReviewDisposition {
  if (status === 'fail') return { holdFromQueue: true, machineReviewed: true }
  if (status === 'pass') return { holdFromQueue: false, machineReviewed: true }
  return { holdFromQueue: false, machineReviewed: false }
}

/** A review that threw or timed out. Status stays unverifiable so it is never treated as a pass. */
export function notMachineReviewedCheck(videoUrl: string, reason: string, now = new Date()): MaliangCheck {
  return {
    status: 'unverifiable',
    checked_at: now.toISOString(),
    video_url: videoUrl,
    reasons: [reason.slice(0, 500)],
    frames: [],
    model: null,
  }
}

export function stampWorkOrderOutput(current: unknown, check: MaliangCheck): Record<string, unknown> {
  const merged = mergeMaliangIntoSnapshot(current, check)
  merged[MACHINE_REVIEWED_KEY] = dispositionOf(check.status).machineReviewed
  return merged
}

/** Runs the check, and turns a throw or a timeout into an unverifiable verdict. */
export async function runCheckWithTimeout(
  run: () => Promise<MaliangCheck>,
  timeoutMs: number,
  videoUrl: string,
): Promise<MaliangCheck> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(),
      new Promise<MaliangCheck>((resolve) => {
        timer = setTimeout(() => {
          resolve(notMachineReviewedCheck(videoUrl, `马良自检超时（${Math.round(timeoutMs / 1000)} 秒），未完成机器审`))
        }, timeoutMs)
      }),
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return notMachineReviewedCheck(videoUrl, `马良自检失败：${message}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}
