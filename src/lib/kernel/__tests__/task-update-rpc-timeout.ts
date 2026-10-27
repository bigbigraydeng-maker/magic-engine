/**
 * Vitest 3.2.4 (the version locked in this repo) can only ignore unhandled
 * errors with a boolean. `onUnhandledError` arrived in Vitest 4.
 *
 * The architecture worker sometimes reports one confirmed RPC timeout after
 * every test has passed: `[vitest-worker]: Timeout calling "onTaskUpdate"`.
 * That string is produced with no suffix. Neighbouring RPC timeouts, including
 * `onUnhandledError`, get extra text and must still fail the run.
 */

export const TASK_UPDATE_RPC_TIMEOUT_MESSAGE =
  '[vitest-worker]: Timeout calling "onTaskUpdate"'

type UnhandledErrorGate = {
  _checkUnhandledErrors: (errors: unknown[]) => void
}

const installed = new WeakSet<object>()

export function isTaskUpdateRpcTimeout(error: unknown): boolean {
  return errorMessage(error) === TASK_UPDATE_RPC_TIMEOUT_MESSAGE
}

export function unhandledErrorsThatFail(errors: readonly unknown[]): unknown[] {
  return errors.filter((error) => !isTaskUpdateRpcTimeout(error))
}

/**
 * Replace Vitest's exit gate. The original honors `dangerouslyIgnoreUnhandledErrors`,
 * so calling it would let that boolean hide every rejection again.
 */
export function installTaskUpdateTimeoutTolerance(vitest: UnhandledErrorGate): void {
  if (installed.has(vitest)) return
  if (typeof vitest._checkUnhandledErrors !== 'function') {
    throw new Error(
      'This Vitest build has no _checkUnhandledErrors gate. Refusing to ignore unhandled errors.',
    )
  }
  vitest._checkUnhandledErrors = (errors) => {
    if (unhandledErrorsThatFail(errors).length > 0) process.exitCode = 1
  }
  installed.add(vitest)
}

function errorMessage(error: unknown): string | null {
  if (typeof error === 'string') return error
  if (typeof error !== 'object' || error === null || !('message' in error)) return null
  const message = error.message
  return typeof message === 'string' ? message : null
}
