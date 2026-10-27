import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { TASK_UPDATE_RPC_TIMEOUT_MESSAGE as EXACT } from './architecture-global-setup'

const ROOT = join(__dirname, '../../../..')

function run(messages: string[]): number {
  const dir = mkdtempSync(join(__dirname, '.rpc-repro-'))
  try {
    const testFile = join(dir, 'repro.case.ts')
    const rejects = messages.map((m) => `new Promise((_, r) => r(new Error(${JSON.stringify(m)})))`).join('\n')
    writeFileSync(testFile, `import { test } from 'vitest'\ntest('ok', () => {})\n${rejects}\n`)
    const setup = join(__dirname, 'architecture-global-setup.ts')
    writeFileSync(join(dir, 'repro.config.ts'), `import { defineConfig } from 'vitest/config'\nexport default defineConfig({ root: ${JSON.stringify(ROOT)}, test: { include: [${JSON.stringify(testFile)}], environment: 'node', setupFiles: [], globalSetup: [${JSON.stringify(setup)}], watch: false } })\n`)
    const env: NodeJS.ProcessEnv = { ...process.env }
    delete env.VITEST
    for (const key of Object.keys(env)) if (key.startsWith('VITEST_')) delete env[key]
    const result = spawnSync(process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--config', join(dir, 'repro.config.ts')], { cwd: ROOT, encoding: 'utf8', timeout: 120_000, env })
    return result.status ?? 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

it('fails real unhandled rejections and passes only the exact onTaskUpdate timeout', () => {
  expect(run(['real unhandled rejection'])).toBe(1)
  expect(run([EXACT])).toBe(0)
  expect(run([EXACT, 'second real rejection'])).toBe(1)
  expect(run(['[vitest-worker]: Timeout calling "onUnhandledError" with "x"'])).toBe(1)
})
