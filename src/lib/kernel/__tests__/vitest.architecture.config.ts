/**
 * CI 专用的 vitest 配置：只跑 architecture.test.ts，不继承根目录的 vitest.config.ts / vitest.setup.ts。
 *
 * 🔴 为什么单独一份：根配置和 setup 文件不在 A 级路径里。一个 B 级 PR 就能在那儿
 *    把这个测试排除掉、换成路径相似的诱饵文件（命令行的文件过滤按子串匹配）、
 *    或者在 setup 里把断言改成空操作 —— 检查照样是绿的，还会被自动合并。
 *    这份配置放在 A 级路径 src/lib/kernel/ 下，改它要过 A 级审。
 *
 * 用法见 .github/workflows/pr-light-checks.yml；本地照旧可以用根配置跑同一个文件。
 */
import { defineConfig } from 'vitest/config'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')

export default defineConfig({
  root: ROOT,
  resolve: {
    alias: { '@': path.join(ROOT, 'src') },
  },
  test: {
    include: ['src/lib/kernel/__tests__/architecture.test.ts'],
    environment: 'node',
    // 「注册表的封闭性」那条会间接 import 到一个模块，它在加载时就检查这几个变量。
    // 给假值（跟 vitest.setup.ts 同一组），不连任何服务。
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    },
    setupFiles: [],
    passWithNoTests: false,
    allowOnly: false,
    // CI 上整文件同步扫描会堵住 worker 超过 60 秒，onTaskUpdate 超时。
    // 203 条有没有跑过仍由 confirm-vitest-json 对 JSON 报告卡下限。
    dangerouslyIgnoreUnhandledErrors: true,
  },
})
