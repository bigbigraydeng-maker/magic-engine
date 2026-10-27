import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  TASK_UPDATE_RPC_TIMEOUT_MESSAGE,
  installTaskUpdateTimeoutTolerance,
  isTaskUpdateRpcTimeout,
  unhandledErrorsThatFail,
} from './task-update-rpc-timeout'

const ROOT = join(__dirname, '../../../..')
const SETUP = join(__dirname, 'architecture-global-setup.ts')
const VITEST_BIN = join(ROOT, 'node_modules/vitest/vitest.mjs')
const REPRO_ROOT = join(__dirname, '.rpc-repro')

const PASSING_TEST = "import { test } from 'vitest'\ntest('passes', () => {})\n"

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  delete env.VITEST
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITEST_')) delete env[key]
  }
  return env
}

function rejection(message: string): string {
  return `new Promise((_, reject) => reject(new Error(${JSON.stringify(message)})))\n`
}

function configSource(testFile: string): string {
  return [
    "import { defineConfig } from 'vitest/config'",
    'export default defineConfig({',
    `  root: ${JSON.stringify(ROOT)},`,
    '  test: {',
    `    include: [${JSON.stringify(testFile)}],`,
    "    environment: 'node',",
    '    setupFiles: [],',
    `    globalSetup: [${JSON.stringify(SETUP)}],`,
    '    watch: false,',
    '    passWithNoTests: false,',
    '  },',
    '})',
    '',
  ].join('\n')
}

function runFixture(source: string): { status: number; output: string } {
  mkdirSync(REPRO_ROOT, { recursive: true })
  const dir = mkdtempSync(join(REPRO_ROOT, 'case-'))
  const testFile = join(dir, 'repro.case.ts')
  const configFile = join(dir, 'repro.config.ts')
  writeFileSync(testFile, source)
  writeFileSync(configFile, configSource(testFile))
  const result = spawnSync(process.execPath, [VITEST_BIN, 'run', '--config', configFile, '--reporter=verbose'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: childEnv(),
  })
  rmSync(dir, { recursive: true, force: true })
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  }
}

describe('onTaskUpdate RPC timeout filter', () => {
  afterAll(() => {
    rmSync(REPRO_ROOT, { recursive: true, force: true })
  })

  it('matches only the exact worker RPC timeout message', () => {
    const exact = { message: TASK_UPDATE_RPC_TIMEOUT_MESSAGE, type: 'Unhandled Rejection' }
    expect(isTaskUpdateRpcTimeout(exact)).toBe(true)
    expect(isTaskUpdateRpcTimeout(new Error(TASK_UPDATE_RPC_TIMEOUT_MESSAGE))).toBe(true)
    expect(isTaskUpdateRpcTimeout(TASK_UPDATE_RPC_TIMEOUT_MESSAGE)).toBe(true)
    expect(isTaskUpdateRpcTimeout(new Error(`${TASK_UPDATE_RPC_TIMEOUT_MESSAGE} with "extra"`))).toBe(false)
    expect(isTaskUpdateRpcTimeout(new Error('[vitest-worker]: Timeout calling "onUnhandledError"'))).toBe(false)
    expect(isTaskUpdateRpcTimeout(new Error(`Error: ${TASK_UPDATE_RPC_TIMEOUT_MESSAGE}`))).toBe(false)
    expect(isTaskUpdateRpcTimeout({ message: 1 })).toBe(false)
    expect(isTaskUpdateRpcTimeout(null)).toBe(false)
    expect(unhandledErrorsThatFail([exact, new Error('real')])).toHaveLength(1)
  })

  it('sets the process exit code only when a non-timeout error remains', () => {
    const previous = process.exitCode
    const gate = {
      _checkUnhandledErrors(_errors: unknown[]) {
        throw new Error('original gate should be replaced')
      },
    }
    try {
      process.exitCode = undefined
      installTaskUpdateTimeoutTolerance(gate)
      gate._checkUnhandledErrors([{ message: TASK_UPDATE_RPC_TIMEOUT_MESSAGE }])
      expect(process.exitCode).toBeUndefined()
      gate._checkUnhandledErrors([
        { message: TASK_UPDATE_RPC_TIMEOUT_MESSAGE },
        { message: 'real unhandled rejection' },
      ])
      expect(process.exitCode).toBe(1)
      installTaskUpdateTimeoutTolerance(gate)
    } finally {
      process.exitCode = previous
    }
  })

  it('refuses to install when this Vitest build has no exit gate', () => {
    const gate = {} as { _checkUnhandledErrors: (errors: unknown[]) => void }
    expect(() => installTaskUpdateTimeoutTolerance(gate)).toThrow(/_checkUnhandledErrors/)
  })

  it('does not turn the architecture config back into a blanket ignore', () => {
    const source = readFileSync(join(__dirname, 'vitest.architecture.config.ts'), 'utf8')
    expect(source.includes('dangerouslyIgnoreUnhandledErrors:')).toBe(false)
    expect(source).toContain('architecture-global-setup.ts')
  })

  it('fails a real Vitest run for a non-RPC unhandled rejection', () => {
    const run = runFixture(PASSING_TEST + rejection('real unhandled rejection'))
    expect(run.status, run.output).toBe(1)
    expect(run.output).toContain('1 passed')
    expect(run.output).not.toContain('1 failed')
  })

  it('lets a real Vitest run pass when the only unhandled error is the RPC timeout', () => {
    const run = runFixture(PASSING_TEST + rejection(TASK_UPDATE_RPC_TIMEOUT_MESSAGE))
    expect(run.status, run.output).toBe(0)
    expect(run.output).toContain('1 passed')
  })

  it('still fails when the RPC timeout is accompanied by another rejection', () => {
    const source = PASSING_TEST
      + rejection(TASK_UPDATE_RPC_TIMEOUT_MESSAGE)
      + rejection('second real rejection')
    const run = runFixture(source)
    expect(run.status, run.output).toBe(1)
  })

  it('still fails a near-miss RPC timeout from the same worker channel', () => {
    const nearMiss = '[vitest-worker]: Timeout calling "onUnhandledError" with "real unhandled rejection"'
    const run = runFixture(PASSING_TEST + rejection(nearMiss))
    expect(run.status, run.output).toBe(1)
  })
})
