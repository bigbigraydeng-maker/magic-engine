import { installTaskUpdateTimeoutTolerance } from './task-update-rpc-timeout'

type MainProcess = {
  vitest: {
    _checkUnhandledErrors: (errors: unknown[]) => void
  }
}

/** Loaded by the architecture config. Runs in the Vitest main process, before workers. */
export function setup(project: MainProcess): void {
  installTaskUpdateTimeoutTolerance(project.vitest)
}
