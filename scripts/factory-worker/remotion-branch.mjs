// Remotion render branch for the factory worker. All IO is injected through `deps`.
import { spawn } from 'node:child_process'
import {
  existsSync, copyFileSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
  openSync, closeSync, fstatSync, constants,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Directory that holds the Remotion package (schema.ts, timing.ts, render.mjs). */
export const REMOTION_ENGINE_DIR = join(import.meta.dirname, 'engines', 'remotion')

/** Non-retryable order error: the server must not hand this order back to us. */
export class RemotionOrderError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RemotionOrderError'
    this.retryable = false
  }
}

// Map brief.engine to a branch name; unknown values are refused, never legacy.
export function resolveEngine(brief) {
  const engine = brief?.engine
  if (engine === undefined || engine === null) return 'legacy'
  if (engine === 'remotion') return 'remotion'
  throw new RemotionOrderError(
    `不认识的引擎 "${engine}"：只支持缺省(旧流程)和 remotion，已拒绝，没有落进旧流程。`,
  )
}

// True when this Node can import .ts files directly (type stripping).
function nodeSupportsTs(version) {
  const [major, minor] = version.split('.').map((n) => Number.parseInt(n, 10))
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false
  return major >= 24 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18)
}

// Return a list of Chinese problem lines (each with a fix); empty means healthy.
export function checkRemotionHealth({
  engineDir = REMOTION_ENGINE_DIR,
  nodeVersion = process.versions.node,
  env = process.env,
  existsFn = existsSync,
} = {}) {
  const problems = []
  if (!nodeSupportsTs(nodeVersion)) {
    problems.push(
      `Node ${nodeVersion} 太旧，不能直接 import .ts 校验文件。修法：升级到 Node ≥ 22.18（或 23.6 / 24+）。`,
    )
  }
  const npmFix = `修法：在 ${engineDir} 跑 npm ci。`
  if (!existsFn(join(engineDir, 'node_modules', '@remotion', 'renderer'))) {
    problems.push(`缺少 @remotion/renderer。${npmFix}`)
  }
  if (!existsFn(join(engineDir, 'node_modules', 'zod'))) {
    problems.push(`缺少 zod。${npmFix}`)
  }
  const browserFix = `修法：设置 REMOTION_BROWSER_EXECUTABLE，或在该目录跑一次 node render.mjs 让它下载浏览器。`
  const browserEnv = env.REMOTION_BROWSER_EXECUTABLE
  if (browserEnv) {
    if (!existsFn(browserEnv)) {
      problems.push(`REMOTION_BROWSER_EXECUTABLE 指向的文件不存在：${browserEnv}。${browserFix}`)
    }
  } else if (!existsFn(join(engineDir, 'node_modules', '.remotion', 'chrome-headless-shell', 'VERSION'))) {
    problems.push(`没找到 Remotion 自带的浏览器。${browserFix}`)
  }
  return problems
}

// Dynamically import the Remotion validation modules (only used in this branch).
export async function loadRemotionEngine(engineDir = REMOTION_ENGINE_DIR) {
  try {
    const timing = await import(pathToFileURL(join(engineDir, 'src', 'timing.ts')).href)
    const templates = await import(pathToFileURL(join(engineDir, 'src', 'templates.ts')).href)
    const montage = await import(pathToFileURL(join(engineDir, 'src', 'montage.ts')).href)
    const music = await import(pathToFileURL(join(engineDir, 'src', 'music.ts')).href)
    let catalog = null
    return {
      computeTimingFromProps: timing.computeTimingFromProps,
      FPS: timing.FPS,
      isTemplateId: templates.isTemplateId,
      loadTemplate: templates.loadTemplate,
      montageFrameOf: montage.montageFrameOf,
      musicSourceFor: (name) => {
        catalog ??= music.parseMusicCatalog(
          JSON.parse(readFileSync(join(engineDir, 'catalog', 'music.json'), 'utf8')),
        )
        return templates.musicSourceOf(catalog, name)
      },
    }
  } catch (e) {
    throw new RemotionOrderError(
      `无法载入 Remotion 校验模块：${e.message}。修法：在 ${engineDir} 跑 npm ci，并确认 Node ≥ 22.18。`,
    )
  }
}

// Trim, NFKC-normalize and strip invisible, bidi and control characters.
const clean = (s) => String(s).trim().normalize('NFKC').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff]/g, '')

// Build the on-screen text blocks (hook / items / reveal) as cleaned strings.
export function buildRemotionText(props) {
  const hook = props.hook.lines
    .map((line) => (line.badge ? clean(line.badge) + ' ' : '') + clean(line.text))
    .join(' ')
  const n = props.items.length
  const items = props.items.map(
    (item, i) => `${clean(props.itemLabel)} ${i + 1}/${n} ${clean(item.text)}`,
  )
  const p = props.price
  const reveal = [
    clean(props.revealTitle),
    clean(p.fromLabel),
    clean(`${p.currencyPrefix}${p.amount.toLocaleString('en-US')}`),
    clean(p.qualifier),
    clean(p.dateLine),
    clean(p.footnote),
  ].join(' ')
  return { hook, items, reveal }
}

// Every on-screen string joined for the server-side red-line rescan.
export function buildRemotionCaption(props) {
  const { hook, items, reveal } = buildRemotionText(props)
  return [hook, ...items, reveal].join(' · ')
}

// Format seconds as HH:MM:SS,mmm using integer milliseconds only.
const fmtTime = (sec) =>
  new Date(Math.round(Math.max(0, sec) * 1000)).toISOString().slice(11, 23).replace('.', ',')

// Build the SRT captions from the timing layout.
export function buildRemotionSrt(props, timing, fps) {
  const { hook, items, reveal } = buildRemotionText(props)
  const cues = [[0, timing.hookFrames / fps, hook]]
  for (let i = 0; i < items.length; i++) {
    cues.push([timing.itemFrom[i] / fps, (timing.itemFrom[i] + timing.itemDur[i]) / fps, items[i]])
  }
  cues.push([timing.revealFrom / fps, timing.totalFrames / fps - 0.1, reveal])
  return cues
    .map(([from, to, text], i) => `${i + 1}\n${fmtTime(from)} --> ${fmtTime(to)}\n${text}\n\n`)
    .join('')
}

// Every montage word joined with plain spaces for the server-side red-line rescan,
// so multi-word banned phrases still match as substrings.
export function buildMontageCaption(props) {
  return props.words.map((w) => clean(w.text)).join(' ')
}

// Refuse montage props whose words are all invisible after cleaning.
export function assertMontageTextVisible(props) {
  props.words.forEach((w, i) => {
    if (clean(w.text) === '') {
      throw new RemotionOrderError(`蒙太奇第 ${i + 1} 个词清理后是空的（只含不可见字符）`)
    }
  })
}

// Build the SRT captions for the montage layout, one cue per word.
export function buildMontageSrt(props, frameOf, fps) {
  const endSec = frameOf(props.beats, props.totalBeats) / fps
  return props.words
    .map((w, i) => {
      const from = frameOf(props.beats, w.at) / fps
      const to = Math.max(from + 0.05, Math.min(frameOf(props.beats, w.at + w.beats) / fps, endSec - 0.1))
      return `${i + 1}\n${fmtTime(from)} --> ${fmtTime(to)}\n${clean(w.text)}\n\n`
    })
    .join('')
}

// True when `child` is inside `parent` (separator-aware, not a bare prefix).
const isInside = (parent, child) => {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))
}

// Copy a file that must stay inside `rootReal`, guarding against TOCTOU swaps.
export function copyWithinRoot(srcReal, rootReal, dest) {
  const fd = openSync(srcReal, constants.O_RDONLY | constants.O_NOFOLLOW)
  let buf
  try {
    if (!fstatSync(fd).isFile()) throw new Error('not a regular file')
    buf = readFileSync(fd)
  } finally {
    closeSync(fd)
  }
  writeFileSync(dest, buf)
  const again = realpathSync(srcReal)
  if (again !== srcReal || !isInside(rootReal, again)) {
    rmSync(dest, { force: true })
    throw new Error('source changed during copy')
  }
}

// Copy the referenced assets into the staging directory.
export function stageRemotionAssets({ props, files, stageDir, brandkitDir, assetLibDir, clientRootDir, musicPath = null, musicRoot = null }) {
  if (!props.logoFile.toLowerCase().endsWith('.png')) {
    throw new RemotionOrderError('logo 文件名必须是 .png（logo 一律取自该客户品牌包的 watermark.png）')
  }
  const lower = files.map((f) => f.toLowerCase())
  if (new Set(lower).size !== lower.length) {
    throw new RemotionOrderError('素材文件名大小写不敏感地重复了，请改名')
  }

  const logoDest = join(stageDir, props.logoFile)
  mkdirSync(dirname(logoDest), { recursive: true })
  copyFileSync(join(brandkitDir, 'assets', 'watermark.png'), logoDest)

  if (musicPath !== null) {
    try {
      const musicReal = realpathSync(musicPath)
      const rootReal = realpathSync(musicRoot)
      if (!isInside(rootReal, musicReal) || !statSync(musicReal).isFile()) throw new Error('bad')
      const musicDest = join(stageDir, props.musicFile)
      mkdirSync(dirname(musicDest), { recursive: true })
      copyWithinRoot(musicReal, rootReal, musicDest)
    } catch {
      throw new RemotionOrderError(`乐库里找不到音乐文件：${props.musicFile}（应在 ${musicRoot}）`)
    }
  }

  const others = files.filter((f) => f !== props.logoFile && !(musicPath !== null && f === props.musicFile))
  if (others.length === 0) return

  let libReal
  try {
    libReal = realpathSync(assetLibDir)
    if (!isInside(realpathSync(clientRootDir), libReal)) throw new Error('outside')
  } catch {
    throw new RemotionOrderError(`素材库目录不存在，或不在该客户的 studio 文件夹内：${assetLibDir}。请把素材放到该目录`)
  }

  const missing = []
  for (const name of others) {
    const dest = join(stageDir, name)
    try {
      const srcReal = realpathSync(resolve(libReal, name))
      if (!isInside(libReal, srcReal) || !statSync(srcReal).isFile()) throw new Error('bad')
      mkdirSync(dirname(dest), { recursive: true })
      copyWithinRoot(srcReal, libReal, dest)
    } catch (e) {
      if (e instanceof RemotionOrderError) throw e
      missing.push(name)
    }
  }
  if (missing.length > 0) {
    throw new RemotionOrderError(`缺少素材文件：${missing.join(', ')}。请放到 ${assetLibDir}`)
  }
}

// Last 300 chars of stderr; worker.mjs truncates messages to 500 chars.
const lastLines = (res) => String(res.stderrTail ?? '').slice(-300)

// Spawn the render CLI in its own process group; never rejects.
export function runRemotionRender({
  propsFile,
  outFile,
  publicDir,
  tmpDir,
  template = 'list',
  engineDir = REMOTION_ENGINE_DIR,
  timeoutSec = 600,
  signal,
  env = process.env,
  spawnFn = spawn,
}) {
  return new Promise((resolvePromise) => {
    const child = spawnFn(process.execPath, [
      join(engineDir, 'render.mjs'),
      '--props', propsFile,
      '--out', outFile,
      '--template', template,
      '--public-dir', publicDir,
      '--timeout-sec', String(timeoutSec),
    ], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: env.PATH,
        HOME: env.HOME,
        TMPDIR: tmpDir,
        ...(env.LANG !== undefined && { LANG: env.LANG }),
        ...(env.REMOTION_BROWSER_EXECUTABLE !== undefined && {
          REMOTION_BROWSER_EXECUTABLE: env.REMOTION_BROWSER_EXECUTABLE,
        }),
      },
    })

    let tail = ''
    let timedOut = false
    // Kill the whole process group so the browser child dies with the CLI.
    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        /* already gone */
      }
    }
    const append = (buf) => {
      tail = (tail + buf.toString()).slice(-2000)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)

    const safety = setTimeout(() => {
      timedOut = true
      killGroup()
      setTimeout(() => finish(null), 3000)
    }, (timeoutSec + 30) * 1000)

    const onAbort = () => killGroup()
    if (signal) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }

    let done = false
    const finish = (code) => {
      if (done) return
      done = true
      clearTimeout(safety)
      signal?.removeEventListener('abort', onAbort)
      killGroup()
      resolvePromise({ code: timedOut ? 124 : code, stderrTail: tail })
    }

    child.on('error', (e) => {
      tail = (tail + e.message).slice(-2000)
      finish(null)
    })
    child.on('close', (code) => finish(code))
    // A surviving grandchild can hold the pipes open, so 'close' may never fire.
    child.on('exit', (code) => setTimeout(() => finish(code), 3000))
  })
}

// Refuse orders this branch cannot handle; throws RemotionOrderError.
function assertRemotionBrief(wo, deps) {
  const clientId = String(wo.client_id).toLowerCase()
  if (!deps.allowedClientIds.includes(clientId)) {
    throw new RemotionOrderError(
      '这个客户没有开通 remotion 出片：把 client_id 加进出片机的 FACTORY_REMOTION_CLIENT_IDS',
    )
  }
  const brief = wo.brief ?? {}
  if (brief.creative_recipe != null) {
    throw new RemotionOrderError('remotion 单不能同时带 creative_recipe')
  }
  if (brief.recipe_replan_required === true || brief.review_feedback_digest || brief.review_feedback || brief.reopened_from) {
    throw new RemotionOrderError('remotion 引擎暂不支持打回重做：重渲只会得到同一条片子')
  }
  const remotion = brief.remotion
  if (!remotion || typeof remotion !== 'object' || typeof remotion.template !== 'string' || typeof remotion.props !== 'object' || remotion.props === null) {
    throw new RemotionOrderError('工单缺少 brief.remotion（必须带 template 字符串和 props 对象）')
  }
  return remotion
}

// Poll the server while rendering; abort the render on abort/409.
function startHeartbeats({ woId, heartbeatFn, intervalMs, log }) {
  const ac = new AbortController()
  let fatal = null
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    let t
    try {
      const timeout = new Promise((_, rej) => {
        t = setTimeout(() => rej(new Error('heartbeat timeout 15s')), 15000)
      })
      const r = await Promise.race([heartbeatFn(woId, 0), timeout])
      if (r?.abort === true) {
        fatal = new RemotionOrderError('服务器要求停止这张工单（abort）')
        ac.abort()
      }
    } catch (e) {
      if (/status 409/.test(e.message)) {
        fatal = new RemotionOrderError('工单已被服务器收回（409），停止渲染')
        ac.abort()
      } else {
        log(`remotion 心跳失败（忽略）：${e.message}`)
      }
    } finally {
      clearTimeout(t)
      running = false
    }
  }, intervalMs)
  return {
    signal: ac.signal,
    assertAlive: () => {
      if (fatal) throw fatal
    },
    stop: () => clearInterval(timer),
  }
}

// Run the whole remotion branch for one work order.
export async function processRemotionOrder({ wo, tmp, deps }) {
  const {
    healthFn = checkRemotionHealth,
    loadEngineFn = loadRemotionEngine,
    renderFn = runRemotionRender,
    heartbeatIntervalMs = 60000,
    timeoutSec = 600,
  } = deps

  const remotion = assertRemotionBrief(wo, deps)

  const problems = healthFn()
  if (problems.length > 0) {
    throw new RemotionOrderError('出片机还没装好 Remotion：' + problems.join('；'))
  }

  const eng = await loadEngineFn()
  const template = remotion.template
  if (!eng.isTemplateId(template)) {
    throw new RemotionOrderError(
      `UNKNOWN_TEMPLATE: 不认识的模板 ${JSON.stringify(String(template)).slice(0, 40)}：出片机的模板注册表里没有它。先升级出片机，或检查工单 brief.remotion.template`,
    )
  }
  let props
  let files
  let timing
  let totalFrames
  try {
    const loaded = eng.loadTemplate(template, remotion.props)
    props = loaded.props
    files = loaded.assetFiles
    totalFrames = loaded.totalFrames
    timing = template === 'list' ? eng.computeTimingFromProps(props) : null
  } catch (e) {
    throw new RemotionOrderError('工单里的视频参数不合格：' + e.message)
  }
  if (template === 'montage') assertMontageTextVisible(props)

  const hb = startHeartbeats({
    woId: wo.work_order_id,
    heartbeatFn: deps.heartbeatFn,
    intervalMs: heartbeatIntervalMs,
    log: deps.log,
  })

  try {
    const root = join(tmp, 'remotion')
    const stageDir = join(root, 'assets')
    const outDir = join(root, 'out')
    const tmpDir = join(root, 'tmp')
    for (const d of [stageDir, outDir, tmpDir]) mkdirSync(d, { recursive: true })

    let brandkitDir
    try {
      brandkitDir = deps.brandkitFor(wo.client_id)
    } catch (e) {
      throw new RemotionOrderError(e.message)
    }
    const clientRootDir = join(deps.studioRoot, deps.clientStudio[wo.client_id])
    const assetLibDir = join(clientRootDir, 'remotion-assets')
    let musicSource = null
    if (props.musicFile) {
      try {
        musicSource = eng.musicSourceFor(props.musicFile)
      } catch (e) {
        throw new RemotionOrderError('音乐目录读不了：' + e.message)
      }
    }
    if (musicSource && existsSync(join(assetLibDir, props.musicFile))) {
      deps.log(`音乐 ${props.musicFile} 在共享乐库和客户素材库里都有，按乐库版本出片（乐库优先）`)
    }
    const musicRoot = musicSource ? join(deps.studioRoot, musicSource.folder) : null
    const musicPath = musicSource ? join(musicRoot, musicSource.file) : null
    stageRemotionAssets({ props, files, stageDir, brandkitDir, assetLibDir, clientRootDir, musicPath, musicRoot })
    hb.assertAlive()

    const propsFile = join(root, 'props.json')
    writeFileSync(propsFile, JSON.stringify(props, null, 2))
    const finalPath = join(outDir, 'final.mp4')

    const startedAt = Date.now()
    let attempts = 0
    for (let attempt = 1; attempt <= 2; attempt++) {
      attempts = attempt
      const res = await renderFn({
        propsFile,
        outFile: finalPath,
        publicDir: stageDir,
        tmpDir,
        template,
        timeoutSec,
        signal: hb.signal,
      })
      hb.assertAlive()
      if (res.code === 0) break
      if (res.code === 124) {
        throw new RemotionOrderError(`渲染超时（超过 ${timeoutSec} 秒）：${lastLines(res)}`)
      }
      if (res.code === 2 || res.code === 3 || res.code === 4) {
        throw new RemotionOrderError(`渲染前检查没过（退出码 ${res.code}）：${lastLines(res)}`)
      }
      if (attempt === 1) {
        deps.log(`remotion 渲染失败（退出码 ${res.code}），重试一次：${lastLines(res)}`)
        continue
      }
      throw new Error('渲染失败（已重试 1 次）：' + lastLines(res))
    }
    const elapsed_s = Math.round((Date.now() - startedAt) / 1000)

    const stat = statSync(finalPath)
    if (!stat.isFile() || stat.size <= 0) {
      throw new RemotionOrderError('成片体检没过：渲染产物不存在或为空')
    }
    const srtText = template === 'list'
      ? buildRemotionSrt(props, timing, eng.FPS)
      : buildMontageSrt(props, eng.montageFrameOf, eng.FPS)
    const caption = template === 'list' ? buildRemotionCaption(props) : buildMontageCaption(props)
    const evidence = deps.probeMediaEvidenceFn(finalPath, srtText)
    const expected = totalFrames / eng.FPS
    if (evidence.width !== 1080 || evidence.height !== 1920) {
      if (!Number.isInteger(evidence.width)) {
        throw new RemotionOrderError('成片体检没过：没测到分辨率（出片机的 ffprobe 可能没装好）')
      }
      throw new RemotionOrderError(`成片体检没过：分辨率是 ${evidence.width}x${evidence.height}，应为 1080x1920`)
    }
    if (!Number.isFinite(evidence.duration_seconds) || Math.abs(evidence.duration_seconds - expected) > 0.5) {
      throw new RemotionOrderError(`成片体检没过：时长 ${evidence.duration_seconds}s 与预期 ${expected.toFixed(2)}s 不符`)
    }
    if (props.musicFile !== null && evidence.audio_stream_present !== true) {
      throw new RemotionOrderError('成片体检没过：工单配了音乐，但成片里没有音轨')
    }
    hb.assertAlive()

    const segmentsJson = Buffer.from(
      JSON.stringify({
        engine: 'remotion',
        template,
        music: musicSource
          ? { source: 'catalog', id: musicSource.id, folder: musicSource.folder, file: musicSource.file, status: musicSource.status }
          : (props.musicFile ? { source: 'client_library', file: props.musicFile } : null),
        props,
        render: { attempts, elapsed_s },
      }, null, 2),
    )
    await deps.uploadSignedFn(wo.uploads.video.signed_url, readFileSync(finalPath), 'video/mp4')
    hb.assertAlive()
    await deps.uploadSignedFn(wo.uploads.segments_json.signed_url, segmentsJson, 'application/json')
    hb.assertAlive()
    await deps.uploadSignedFn(wo.uploads.srt.signed_url, Buffer.from(srtText), 'text/plain')
    hb.assertAlive()

    const r = await deps.completeFn({
      worker_id: deps.workerId,
      video_url: wo.uploads.video.path,
      segments_json_url: wo.uploads.segments_json.path,
      srt_url: wo.uploads.srt.path,
      caption,
      actual_cost_usd: 0,
      new_clips: [],
      media_evidence: evidence,
    })
    if (!r.ok) {
      const message = `complete ${r.status}: ${JSON.stringify(r.json)}`
      throw r.status >= 400 && r.status < 500 ? new RemotionOrderError(message) : new Error(message)
    }
    deps.log(`remotion 出片完成：${wo.work_order_id}`)
    return { ok: true, cost: 0 }
  } finally {
    hb.stop()
    rmSync(join(tmp, 'remotion'), { recursive: true, force: true })
  }
}
