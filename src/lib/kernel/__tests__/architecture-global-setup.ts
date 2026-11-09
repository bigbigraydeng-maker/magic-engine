export const TASK_UPDATE_RPC_TIMEOUT_MESSAGE = '[vitest-worker]: Timeout calling "onTaskUpdate"'
const installed = new WeakSet<object>()
type Gate = { _checkUnhandledErrors: (errors: unknown[]) => void }
export function isTaskUpdateRpcTimeout(error: unknown): boolean {
  if (typeof error === 'string') return error === TASK_UPDATE_RPC_TIMEOUT_MESSAGE
  if (typeof error !== 'object' || error === null || !('message' in error)) return false
  return error.message === TASK_UPDATE_RPC_TIMEOUT_MESSAGE
}
export function installTaskUpdateTimeoutTolerance(vitest: Gate): void {
  if (installed.has(vitest)) return
  if (typeof vitest._checkUnhandledErrors !== 'function') {
    throw new Error('No _checkUnhandledErrors gate; refusing to ignore unhandled errors.')
  }
  vitest._checkUnhandledErrors = (errors) => {
    if (errors.some((error) => !isTaskUpdateRpcTimeout(error))) process.exitCode = 1
  }
  installed.add(vitest)
}
export function setup(project: { vitest: Gate }): void {
  installTaskUpdateTimeoutTolerance(project.vitest)
}
