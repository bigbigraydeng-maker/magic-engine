// P21.J M2 — worker 收权三件套单测(路径注入面 = 安全核心,狄仁杰实施后再补攻击验证)

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import path from 'path'
import {
  isWorkerAuthorized,
  scanRedlineHits,
  trackFolder,
  validateClipPath,
  validateRenderPath,
  workerClientWhitelist,
  workerIdFromBody,
} from './worker-guard'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const WO = 'fc681e25-c5e5-49d4-89b7-1c5bfe9819af'

describe('isWorkerAuthorized', () => {
  const OLD = process.env.FACTORY_WORKER_TOKEN
  beforeEach(() => { process.env.FACTORY_WORKER_TOKEN = 'secret-token' })
  afterEach(() => { process.env.FACTORY_WORKER_TOKEN = OLD })

  it('正确 Bearer → 放行', () => {
    expect(isWorkerAuthorized('Bearer secret-token')).toBe(true)
  })
  it('错误 token / 缺 header → 拒', () => {
    expect(isWorkerAuthorized('Bearer wrong')).toBe(false)
    expect(isWorkerAuthorized(null)).toBe(false)
  })
  it('env 未配置 → fail-closed 一律拒', () => {
    delete process.env.FACTORY_WORKER_TOKEN
    expect(isWorkerAuthorized('Bearer secret-token')).toBe(false)
  })
})

describe('workerIdFromBody(魏征 M2-P1-1 归属校验入参)', () => {
  it('合法字符串 → trim 后返回', () => {
    expect(workerIdFromBody({ worker_id: ' local-mac ' })).toBe('local-mac')
  })
  it('缺失 / 空串 / 非字符串 → null(调用方 400)', () => {
    expect(workerIdFromBody({})).toBeNull()
    expect(workerIdFromBody({ worker_id: '  ' })).toBeNull()
    expect(workerIdFromBody({ worker_id: 42 })).toBeNull()
  })
})

describe('workerClientWhitelist', () => {
  const OLD = process.env.FACTORY_WORKER_CLIENT_IDS
  afterEach(() => { process.env.FACTORY_WORKER_CLIENT_IDS = OLD })

  it('逗号分隔 uuid → 列表', () => {
    process.env.FACTORY_WORKER_CLIENT_IDS = `${CLIENT}, ${WO}`
    expect(workerClientWhitelist()).toEqual([CLIENT, WO])
  })
  it('env 未配置 → null(调用方必须拒 claim)', () => {
    delete process.env.FACTORY_WORKER_CLIENT_IDS
    expect(workerClientWhitelist()).toBeNull()
  })
  it('全是非法值 → null,不放行空白名单', () => {
    process.env.FACTORY_WORKER_CLIENT_IDS = 'not-a-uuid, also-bad'
    expect(workerClientWhitelist()).toBeNull()
  })
})

/**
 * FACTORY_WORKER_CLIENT_IDS 配在哪。
 *
 * 名字里带 worker,docs/ENV.md 原来据此标成「worker」,但 worker 自己从来不读它:
 * worker 调 /api/factory/worker/claim,白名单是在那条路由里读的 —— 那是 web 进程。
 * 配到 Render 的 worker 服务上,claim 会一直 fail-closed 拒绝(白名单 null),
 * 表现成「工单一条都领不走」,而排查方向会被变量名带偏。
 *
 * 下面查的是真实事实,不是比对一段固定文案:全仓谁读它、render.yaml 的 worker 服务有没有
 * 声明它、docs/ENV.md 那一格写的是什么。
 *
 * ⚠️ 读取方扫描不能只认 `process.env.X`。本机 worker
 * scripts/factory-worker/worker.mjs 自己有一个 loadEnv() 读 .env 文件,所有配置都走
 * `ENV.X`(FACTORY_WORKER_TOKEN / FACTORY_WORKER_ID / FACTORY_CLIENT_STUDIO 等 13 个)。
 * 只匹配 process.env,恰好会漏掉最该盯的那个文件 —— worker 哪天真开始自己读白名单,
 * 测试还是全绿,文档继续把它写成 web。所以下面按「访问方式」匹配,不是按字面量。
 */
describe('FACTORY_WORKER_CLIENT_IDS 配在哪', () => {
  const ROOT = path.resolve(__dirname, '../../..')
  const ENV_NAME = 'FACTORY_WORKER_CLIENT_IDS'

  /**
   * 递归收集**运行时**源码文件。
   *
   * 跳过 node_modules / .next 等构建产物，也跳过测试本身(`__tests__` 目录和
   * `*.test.*` / `*.spec.*`)—— 测试里出现 ENV.FACTORY_WORKER_CLIENT_IDS 或调用
   * workerClientWhitelist 是正常的，不是「运行时多了个读取方」。按目录和后缀统一排除，
   * 而不是给当前这个文件开特例，否则下一个测试文件照样会误报。
   */
  function walk(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      if (e.name === 'node_modules' || e.name.startsWith('.')) return []
      const full = path.join(dir, e.name)
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(full)
      if (/\.(test|spec)\.(ts|tsx|mjs|cjs|js|py)$/.test(e.name)) return []
      return /\.(ts|tsx|mjs|cjs|js|py)$/.test(e.name) ? [full] : []
    })
  }

  /**
   * 「读这个变量」的各种写法:
   *   - 点号 / 方括号取值:process.env.X · ENV.X · env['X']
   *   - 解构:const { X } = ENV · const { X: ids } = process.env
   * 刻意不匹配裸字符串,否则 claim 路由那句 'FACTORY_WORKER_CLIENT_IDS not configured'
   * 错误文案会被当成读取方。
   */
  const ENV_OBJ = `(?:process\\.env|\\bENV|\\benv)`
  const READ_PATTERNS = [
    new RegExp(`${ENV_OBJ}\\s*(?:\\.\\s*${ENV_NAME}\\b|\\[\\s*['"\`]${ENV_NAME}['"\`]\\s*\\])`),
    new RegExp(`\\{[^{}]*\\b${ENV_NAME}\\b[^{}]*\\}\\s*=\\s*${ENV_OBJ}\\b`),
  ]
  const readsEnv = (src: string) => READ_PATTERNS.some((re) => re.test(src))

  const runtimeFiles = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))]

  const readers = runtimeFiles
    .filter((f) => readsEnv(readFileSync(f, 'utf8')))
    .map((f) => path.relative(ROOT, f))

  it('前提成立:扫到的源码文件数量正常(走空了就不许静默变绿)', () => {
    expect(walk(path.join(ROOT, 'src')).length).toBeGreaterThan(400)
    expect(walk(path.join(ROOT, 'scripts')).length).toBeGreaterThan(5)
  })

  it('前提成立:遍历确实把测试排除在外了(包括本文件)', () => {
    expect(runtimeFiles.some((f) => f.endsWith('worker-guard.test.ts'))).toBe(false)
    expect(runtimeFiles.some((f) => /(\.test\.|\.spec\.|__tests__)/.test(f))).toBe(false)
  })

  it('前提成立:读取方匹配式认得取值和解构两类写法,且不把错误文案当成读取', () => {
    expect(readsEnv(`process.env.${ENV_NAME}`)).toBe(true)
    expect(readsEnv(`const ids = ENV.${ENV_NAME} || ''`)).toBe(true)
    expect(readsEnv(`process.env['${ENV_NAME}']`)).toBe(true)
    expect(readsEnv(`const { ${ENV_NAME} } = ENV`)).toBe(true)
    expect(readsEnv(`const { ${ENV_NAME}: ids } = process.env`)).toBe(true)
    expect(readsEnv(`const { FOO, ${ENV_NAME}, BAR } = env`)).toBe(true)
    expect(readsEnv(`{ error: '${ENV_NAME} not configured' }`)).toBe(false)
    expect(readsEnv(`const { ${ENV_NAME} } = someOtherObject`)).toBe(false)
  })

  it('🔴 全仓唯一读它的地方是 worker-guard.ts —— 多出第二个读取方,配在哪就要重判', () => {
    expect(readers).toEqual(['src/lib/factory/worker-guard.ts'])
  })

  it('🔴 读它的那个函数只被 web 路由用 —— 没有常驻 worker 进程碰它', () => {
    const importers = runtimeFiles
      .filter((f) => !f.endsWith('worker-guard.ts'))
      .filter((f) => readFileSync(f, 'utf8').includes('workerClientWhitelist'))
      .map((f) => path.relative(ROOT, f))
    expect(importers.length).toBeGreaterThan(0)
    expect(importers.every((f) => f.startsWith('src/app/api/'))).toBe(true)
  })

  it('🔴 render.yaml 的 worker 服务没有声明这个变量(声明了说明职责变了)', () => {
    const yaml = readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
    const workers = Array.from(
      yaml.matchAll(/-\s+type:\s+worker\s*\n\s+name:\s*(\S+)([\s\S]*?)(?=\n\s*-\s+type:|$)/g),
    )
    expect(workers.length, 'render.yaml 里一个 worker 服务都没解析到,正则可能写歪了').toBeGreaterThan(0)
    const declaring = workers.filter((m) => m[2].includes(ENV_NAME)).map((m) => m[1])
    expect(declaring).toEqual([])
  })

  it('docs/ENV.md 标的是 Render-web', () => {
    const lines = readFileSync(path.join(ROOT, 'docs/ENV.md'), 'utf8').split('\n')
    const cellsOf = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim())
    const i = lines.findIndex(
      (l) => l.trimStart().startsWith('|') && (cellsOf(l)[0] ?? '').includes(`\`${ENV_NAME}\``),
    )
    expect(i, `docs/ENV.md 里找不到 ${ENV_NAME} 这一行`).toBeGreaterThan(-1)
    let col = -1
    for (let j = i - 1; j >= 0 && lines[j].trimStart().startsWith('|'); j--) {
      const c = cellsOf(lines[j]).findIndex((x) => x.includes('配在哪'))
      if (c >= 0) { col = c; break }
    }
    expect(col, '定位不到「配在哪」那一列').toBeGreaterThan(-1)
    expect(cellsOf(lines[i])[col]).toBe('Render-web')
  })
})

describe('validateRenderPath(F9 前缀强校验)', () => {
  it('bucket 相对路径命中前缀 → 归一化路径', () => {
    expect(validateRenderPath(`renders/${CLIENT}/${WO}/final.mp4`, CLIENT, WO))
      .toBe(`renders/${CLIENT}/${WO}/final.mp4`)
  })
  it('带 bucket 名前缀 → 剥掉后校验', () => {
    expect(validateRenderPath(`content-factory/renders/${CLIENT}/${WO}/segments.json`, CLIENT, WO))
      .toBe(`renders/${CLIENT}/${WO}/segments.json`)
  })
  it('外部 URL 一律拒(注入面正门)', () => {
    expect(validateRenderPath(`https://evil.com/renders/${CLIENT}/${WO}/x.mp4`, CLIENT, WO)).toBeNull()
  })
  it('别的客户/别的工单路径 → 拒', () => {
    expect(validateRenderPath(`renders/${WO}/${WO}/final.mp4`, CLIENT, WO)).toBeNull()
    expect(validateRenderPath(`renders/${CLIENT}/${CLIENT}/final.mp4`, CLIENT, WO)).toBeNull()
  })
  it('路径穿越 / 只有前缀没有文件名 → 拒', () => {
    expect(validateRenderPath(`renders/${CLIENT}/${WO}/../escape.mp4`, CLIENT, WO)).toBeNull()
    expect(validateRenderPath(`renders/${CLIENT}/${WO}/`, CLIENT, WO)).toBeNull()
  })
})

describe('validateClipPath(track 一致性)', () => {
  it('a_real → clips/a-real/{client}/', () => {
    expect(validateClipPath(`clips/a-real/${CLIENT}/harbour.mp4`, CLIENT, 'a_real'))
      .toBe(`clips/a-real/${CLIENT}/harbour.mp4`)
  })
  it('track 与目录不一致 → 拒', () => {
    expect(validateClipPath(`clips/a-real/${CLIENT}/x.mp4`, CLIENT, 'b_generated')).toBeNull()
  })
  it('未知 track → 拒', () => {
    expect(validateClipPath(`clips/a-real/${CLIENT}/x.mp4`, CLIENT, 'c_stock')).toBeNull()
    expect(trackFolder('c_stock')).toBeNull()
  })
})

describe('scanRedlineHits(板桥 #7 成片级复扫)', () => {
  const REDLINES = ['Auckland since 1928', '1928 heritage']
  it('caption 命中红线(大小写不敏感)→ 返回原短语', () => {
    expect(scanRedlineHits(['Serving AUCKLAND  since 1928!'], REDLINES, []))
      .toEqual(['Auckland since 1928'])
  })
  it('text_overlay 命中 excluded_topics 也收', () => {
    expect(scanRedlineHits([null, 'best shutters in town'], REDLINES, ['shutters']))
      .toEqual(['shutters'])
  })
  it('干净文案 → 空数组(不误杀)', () => {
    expect(scanRedlineHits(['25 years in New Zealand'], REDLINES, [])).toEqual([])
  })
  it('多段文本合并扫描,命中去重', () => {
    expect(scanRedlineHits(['auckland since 1928', 'Auckland Since 1928 tours'], REDLINES, []))
      .toEqual(['Auckland since 1928'])
  })
})
