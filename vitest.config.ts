import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // JSX 用跟 Next 生产构建同一套（automatic runtime）—— 否则组件文件必须
  // 多写一行 `import React`，那是为了迁就测试而改生产代码，本末倒置。
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads',
    poolOptions: { threads: { maxThreads: 2 } },
    exclude: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.claude/**',
      // Playwright specs（playwright.config 的 testDir 就指这里），vitest 收进来
      // 只会报「test.describe 不许在这里调」。
      // ⚠️ 说清楚：目前**没有任何 CI workflow 跑 playwright**，本地 `npm run test:e2e`
      //    是它们唯一的运行途径。排除掉不损失 CI 信号（它们在 vitest 下本来就是报错
      //    而不是在测东西），但也别把这当成「已被 e2e 流程覆盖」。见 issue #1401。
      'e2e/**',
      // 内容工厂 worker 目录下混着两种测试：这三个用 node:test（由该包自己的
      // `npm run test:pilot` / `test:cts` 跑），在 vitest 下只会报「找不到 inngest」
      // 或「没有测试套件」。**只排这三个** —— 同目录另外三个
      // （worker / worker.recipe-sequence / creative-recipe）是真的 vitest 测试，
      // 共 142 条，包含 Issue #1218 的回归守卫，必须留在主仓 vitest 里跑。
      'scripts/factory-worker/inngest-pilot.test.mjs',
      'scripts/factory-worker/inngest-cts-workflow.test.mjs',
      'scripts/factory-worker/worker-inngest-bridge.test.mjs',
      // Remotion 渲染引擎是独立 npm 包（自带依赖与 node:test 测试，由它自己的
      // `npm test` 跑）；主仓不装它的依赖，放进来只会报「没有测试套件」。
      'scripts/factory-worker/engines/remotion/**',
      // CI checks the blast-radius script out from main into this folder.
      // Those copies still name the old workflow files, so vitest must not run them.
      '**/.guard-main/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        '.next/',
        '**/*.test.ts',
        '**/*.test.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
