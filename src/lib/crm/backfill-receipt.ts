import { appendFileSync } from 'node:fs'

/**
 * Write the "run started" receipt line before any live write.
 * Throws if the receipt path is not writable so the caller aborts with zero DB changes.
 */
export function writeStartReceipt(path: string, row: Record<string, unknown>): void {
  try {
    appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), what: 'run_started', ...row })}\n`)
  } catch (err) {
    throw new Error(`回执文件不可写，已中止（未做任何数据库更新）：${path} — ${(err as Error).message}`)
  }
}
