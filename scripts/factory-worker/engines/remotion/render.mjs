import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bundle } from '@remotion/bundler'
import { selectComposition, renderMedia, makeCancelSignal } from '@remotion/renderer'
import { TEMPLATE_IDS, isTemplateId, loadTemplate } from './src/templates.ts'

const USAGE = `用法：node render.mjs --props <props.json> --out <out.mp4> [选项]

选项：
  --props <file>              必填，props JSON 文件路径
  --out <file.mp4>            必填，输出 mp4 文件路径（必须以 .mp4 结尾）
  --template <list|montage|datacard|postcard|atmosphere>   模板，默认 list
  --public-dir <dir>          素材目录（默认：render.mjs 同级的 public）
  --concurrency <int>         并发数 1..16（默认 2）
  --timeout-sec <int>         总超时秒数，至少 30（默认 600）
  --browser-executable <path> 浏览器可执行文件路径（默认取环境变量 REMOTION_BROWSER_EXECUTABLE）
  -h, --help                  显示本帮助`

/** Expected failure carrying the process exit code. */
class CliError extends Error {
  constructor(message, exitCode) {
    super(message)
    this.exitCode = exitCode
  }
}

/** Parse an integer option within an inclusive range. */
function parseIntOption(raw, name, min, max) {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliError(`选项 ${name} 必须是 ${min} 到 ${max} 之间的整数，收到：${raw}`, 2)
  }
  return value
}

/** Parse and validate the command line. */
function parseCliArgs(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        props: { type: 'string' },
        out: { type: 'string' },
        template: { type: 'string' },
        'public-dir': { type: 'string' },
        concurrency: { type: 'string' },
        'timeout-sec': { type: 'string' },
        'browser-executable': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (err) {
    throw new CliError(`命令行参数错误：${err.message}`, 2)
  }

  const values = parsed.values
  if (values.help) {
    throw new CliError('已显示帮助', 2)
  }

  const propsFile = values.props
  if (!propsFile) {
    throw new CliError('缺少必填选项 --props', 2)
  }

  const outFile = values.out
  if (!outFile) {
    throw new CliError('缺少必填选项 --out', 2)
  }
  if (!outFile.toLowerCase().endsWith('.mp4')) {
    throw new CliError(`--out 必须以 .mp4 结尾，收到：${outFile}`, 2)
  }

  const template = values.template ?? 'list'
  if (!isTemplateId(template)) {
    throw new CliError(`--template 只能是 ${TEMPLATE_IDS.join(' / ')}，收到：${template}`, 2)
  }

  const defaultPublicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
  const publicDir = values['public-dir'] ? path.resolve(values['public-dir']) : defaultPublicDir

  const concurrency = values.concurrency
    ? parseIntOption(values.concurrency, '--concurrency', 1, 16)
    : 2

  const timeoutSec = values['timeout-sec']
    ? parseIntOption(values['timeout-sec'], '--timeout-sec', 30, 86400)
    : 600

  const browserExecutable =
    values['browser-executable'] || process.env.REMOTION_BROWSER_EXECUTABLE || undefined

  return {
    propsFile: path.resolve(propsFile),
    outFile: path.resolve(outFile),
    template,
    publicDir,
    concurrency,
    timeoutSec,
    browserExecutable,
  }
}

/** Read and validate the props file for the given template. */
function loadProps(propsFile, template) {
  let raw
  try {
    raw = fs.readFileSync(propsFile, 'utf8')
  } catch (err) {
    throw new CliError(`无法读取 props 文件：${propsFile}（${err.message}）`, 3)
  }

  let json
  try {
    json = JSON.parse(raw)
  } catch (err) {
    throw new CliError(`props 文件不是合法 JSON：${err.message}`, 3)
  }

  try {
    // loadTemplate validates props and computes timing, rejecting impossible
    // timing before any browser starts.
    return loadTemplate(template, json)
  } catch (err) {
    throw new CliError(err.message, 3)
  }
}

/** Verify every referenced asset exists inside the public dir (no symlink escapes). */
function checkAssets(assetFiles, publicDir) {
  const missing = []
  const escaped = []
  let realPublicDir
  try {
    realPublicDir = fs.realpathSync(publicDir)
  } catch (err) {
    throw new CliError(`素材目录不存在或不可访问：${publicDir}（${err.message}）`, 4)
  }

  for (const name of assetFiles) {
    const full = path.resolve(publicDir, name)
    let stat
    try {
      stat = fs.statSync(full)
    } catch {
      missing.push(name)
      continue
    }
    if (!stat.isFile()) {
      missing.push(name)
      continue
    }
    let real
    try {
      real = fs.realpathSync(full)
    } catch {
      missing.push(name)
      continue
    }
    const rel = path.relative(realPublicDir, real)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      escaped.push(name)
    }
  }

  const problems = []
  if (missing.length > 0) {
    problems.push(`缺少素材文件：${missing.join(', ')}`)
  }
  if (escaped.length > 0) {
    problems.push(`素材文件越出素材目录：${escaped.join(', ')}`)
  }
  if (problems.length > 0) {
    throw new CliError(problems.join('\n'), 4)
  }
}

/** Remove a temporary bundle directory if it lives under the OS temp dir. */
function cleanupBundle(bundleDir) {
  if (!bundleDir) return
  const tmp = os.tmpdir()
  if (!bundleDir.startsWith(tmp)) return
  try {
    fs.rmSync(bundleDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
}

/** Build the onProgress callback that prints 25/50/75% once each. */
function makeProgressReporter() {
  const printed = new Set()
  return (progress) => {
    for (const mark of [0.25, 0.5, 0.75]) {
      if (progress >= mark && !printed.has(mark)) {
        printed.add(mark)
        process.stderr.write(`进度 ${Math.round(mark * 100)}%\n`)
      }
    }
  }
}

/** Run the full render pipeline. */
async function runRender(opts) {
  const loaded = loadProps(opts.propsFile, opts.template)
  checkAssets(loaded.assetFiles, opts.publicDir)
  for (const gap of loaded.recipeGaps ?? []) {
    process.stdout.write(`配方${gap.status}：${gap.column}（${gap.reason}）\n`)
  }

  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true })
  // A failed run must never leave an older file that looks like a fresh result.
  fs.rmSync(opts.outFile, { force: true })

  const entryPoint = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'index.ts')

  const { cancelSignal, cancel } = makeCancelSignal()
  let timedOut = false
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    cancel()
  }, opts.timeoutSec * 1000)
  let bundleDir
  const hardTimer = setTimeout(() => {
    cleanupBundle(bundleDir)
    process.stderr.write(`渲染超时：超过 ${opts.timeoutSec} 秒，已终止\n`)
    process.exit(124)
  }, opts.timeoutSec * 1000 + 20000)

  const startedAt = Date.now()
  try {
    bundleDir = await bundle({ entryPoint, publicDir: opts.publicDir })

    const composition = await selectComposition({
      serveUrl: bundleDir,
      id: loaded.compositionId,
      inputProps: loaded.props,
      browserExecutable: opts.browserExecutable,
    })

    await renderMedia({
      composition,
      serveUrl: bundleDir,
      codec: 'h264',
      crf: 18,
      outputLocation: opts.outFile,
      inputProps: loaded.props,
      concurrency: opts.concurrency,
      cancelSignal,
      browserExecutable: opts.browserExecutable,
      onProgress: makeProgressReporter(),
    })

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
    const seconds = (composition.durationInFrames / composition.fps).toFixed(1)
    process.stdout.write(
      `完成：${opts.outFile}（${composition.durationInFrames} 帧，${seconds} 秒，用时 ${elapsed} 秒）\n`,
    )
  } catch (err) {
    if (timedOut) {
      throw new CliError(`渲染超时：超过 ${opts.timeoutSec} 秒，已终止`, 124)
    }
    throw new CliError(`渲染失败：${err.message}`, 5)
  } finally {
    clearTimeout(timeoutTimer)
    clearTimeout(hardTimer)
    cleanupBundle(bundleDir)
  }
}

/** Entry point: parse args, run, map errors to exit codes. */
async function main() {
  let opts
  try {
    opts = parseCliArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n\n${USAGE}\n`)
      process.exit(2)
    }
    throw err
  }

  try {
    await runRender(opts)
  } catch (err) {
    if (err instanceof CliError) {
      process.stderr.write(`${err.message}\n`)
      process.exit(err.exitCode)
    }
    process.stderr.write(`渲染失败：${err.message}\n`)
    process.exit(5)
  }
}

// Compare real paths so a symlinked/bin invocation does not silently do nothing.
const invokedPath = process.argv[1] ? fs.realpathSync(process.argv[1]) : ''
if (import.meta.url === pathToFileURL(invokedPath).href) {
  main()
}
