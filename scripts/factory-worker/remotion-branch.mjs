// Remotion render branch for the factory worker. All IO is injected through `deps`.
import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync, copyFileSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
  openSync, closeSync, fstatSync, readSync, writeSync, constants,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  MusicVocalGateError,
  assertMusicVocalClear,
  loadMusicVocalRegistry,
  sha256File,
  usedWindowFromProps,
} from './music-vocal-gate.mjs'
import { MAX_UPLOAD_BYTES, oversizeUploadMessage } from './engines/remotion/encode-cap.mjs'

/** Directory that holds the Remotion package (schema.ts, timing.ts, render.mjs). */
export const REMOTION_ENGINE_DIR = join(import.meta.dirname, 'engines', 'remotion')
export const MUSIC_VOCAL_REGISTRY_PATH = join(REMOTION_ENGINE_DIR, 'catalog', 'music-vocals.json')

/** Non-retryable order error: the server must not hand this order back to us. */
export class RemotionOrderError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RemotionOrderError'
    this.retryable = false
  }
}

// A RemotionOrderError the server may hand back to us (environment/version problems).
const retryableOrderError = (message) => Object.assign(new RemotionOrderError(message), { retryable: true })

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
    const datacard = await import(pathToFileURL(join(engineDir, 'src', 'datacard.ts')).href)
    const postcard = await import(pathToFileURL(join(engineDir, 'src', 'postcard.ts')).href)
    const atmosphere = await import(pathToFileURL(join(engineDir, 'src', 'atmosphere.ts')).href)
    const substance = await import(pathToFileURL(join(engineDir, 'src', 'contentSubstance.ts')).href)
    let catalog = null
    return {
      computeTimingFromProps: timing.computeTimingFromProps,
      FPS: timing.FPS,
      isTemplateId: templates.isTemplateId,
      loadTemplate: templates.loadTemplate,
      montageFrameOf: montage.montageFrameOf,
      computeDataCardTiming: datacard.computeDataCardTiming,
      computePostcardTiming: postcard.computePostcardTiming,
      computeAtmosphereTiming: atmosphere.computeAtmosphereTiming,
      contentSubstanceOf: substance.contentSubstanceOf,
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
    ...(p.dateLine === undefined || p.dateLine === null ? [] : [clean(p.dateLine)]),
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

// Every on-screen data-card string (hook, rows, disclaimer) as cleaned strings, in reading order.
export function buildDatacardText(props) {
  const hook = props.hook.lines.map(clean).join(' ')
  const rows = props.rows.map((r) =>
    [clean(r.label), clean(r.value), ...(r.sublabel === null || r.sublabel === undefined ? [] : [clean(r.sublabel)])].join(' '),
  )
  return { hook, rows, disclaimer: clean(props.disclaimer) }
}

// Every data-card string joined for the server-side red-line rescan.
export function buildDatacardCaption(props) {
  const { hook, rows, disclaimer } = buildDatacardText(props)
  return [hook, ...rows, disclaimer].join(' · ')
}

// Refuse data-card props whose hook, labels, values or disclaimer are all invisible after cleaning.
export function assertDatacardTextVisible(props) {
  const parts = [...props.hook.lines.map((t) => ['钩子', t]), ...props.rows.flatMap((r, i) => [[`第 ${i + 1} 行标签`, r.label], [`第 ${i + 1} 行数值`, r.value], ...(r.sublabel == null ? [] : [[`第 ${i + 1} 行副标签`, r.sublabel]])]), ['免责文案', props.disclaimer]]
  for (const [name, t] of parts) {
    if (clean(t) === '') throw new RemotionOrderError(`数据卡${name}清理后是空的（只含不可见字符）`)
    // The renderer paints raw props; a caption that silently drops bidi/invisible characters could differ from what is on screen.
    if (clean(t) !== String(t).trim().normalize('NFKC')) {
      throw new RemotionOrderError(`数据卡${name}含不可见或双向控制字符：屏幕上显示的和红线复扫看到的可能不一致，请删掉这些字符`)
    }
  }
}

// Every on-screen postcard string (hook, scene place + line, price block) as cleaned strings, in reading order.
export function buildPostcardText(props) {
  const hook = props.hook.lines.map(clean).join(' ')
  const scenes = props.scenes.map((sc) => `${clean(sc.place)} ${clean(sc.line)}`)
  const p = props.price
  const price = p == null
    ? clean(props.end.title)
    : [
      clean(p.fromLabel),
      clean(`${p.currencyPrefix}${p.amount.toLocaleString('en-US')}`),
      clean(p.qualifier),
      ...(p.dateLine === undefined || p.dateLine === null ? [] : [clean(p.dateLine)]),
      clean(p.footnote),
    ].join(' ')
  return { hook, scenes, price }
}

// Every postcard string joined for the server-side red-line rescan.
export function buildPostcardCaption(props) {
  const { hook, scenes, price } = buildPostcardText(props)
  return [hook, ...scenes, price].join(' · ')
}

// The renderer paints raw props, so text that cleans to nothing or differs once invisible characters are dropped must be refused.
export function assertPostcardTextVisible(props) {
  const parts = [
    ...props.hook.lines.map((t) => ['钩子', t]),
    ...props.scenes.flatMap((sc, i) => [[`第 ${i + 1} 景地名`, sc.place], [`第 ${i + 1} 景文案`, sc.line]]),
    ...(props.price == null
      ? [['片尾标题', props.end.title]]
      : [
        ['价格前缀', props.price.fromLabel],
        ['价格说明', props.price.qualifier],
        ['价格脚注', props.price.footnote],
        ...(props.price.dateLine == null ? [] : [['价格日期行', props.price.dateLine]]),
      ]),
  ]
  for (const [name, t] of parts) {
    if (clean(t) === '') throw new RemotionOrderError(`明信片${name}清理后是空的（只含不可见字符）`)
    if (clean(t) !== String(t).trim().normalize('NFKC')) {
      throw new RemotionOrderError(`明信片${name}含不可见或双向控制字符：屏幕上显示的和红线复扫看到的可能不一致，请删掉这些字符`)
    }
  }
}

// Build the SRT captions from the postcard timing layout.
export function buildPostcardSrt(props, timing, fps) {
  const { hook, scenes, price } = buildPostcardText(props)
  const cues = [[0, timing.hookFrames / fps, hook]]
  scenes.forEach((text, i) => cues.push([timing.sceneFrom[i] / fps, (timing.sceneFrom[i] + timing.sceneDur[i]) / fps, text]))
  cues.push([timing.priceFrom / fps, timing.totalFrames / fps - 0.1, price])
  return cues
    .map(([from, to, text], i) => `${i + 1}\n${fmtTime(from)} --> ${fmtTime(to)}\n${text}\n\n`)
    .join('')
}

// Atmosphere reel: at most one on-screen line. No line is a valid reel (no text at all).
export function buildAtmosphereText(props) {
  return props.line == null ? '' : clean(props.line.text)
}

// The line (or nothing) joined for the server-side red-line rescan.
export function buildAtmosphereCaption(props) {
  return buildAtmosphereText(props)
}

// Text that cleans to nothing or differs once invisible characters are dropped must be refused (only when a line exists).
export function assertAtmosphereTextVisible(props) {
  if (props.line == null) return
  const t = props.line.text
  if (clean(t) === '') throw new RemotionOrderError('氛围片文字清理后是空的（只含不可见字符）')
  if (clean(t) !== String(t).trim().normalize('NFKC')) {
    throw new RemotionOrderError('氛围片文字含不可见或双向控制字符：屏幕上显示的和红线复扫看到的可能不一致，请删掉这些字符')
  }
}

// One cue spanning the whole reel. A reel without text still gets a neutral sidecar cue so the subtitle-timing
// check can be measured; the cue is not burned into the picture.
export function buildAtmosphereSrt(props, timing, fps) {
  const text = buildAtmosphereText(props) || '♪'
  return `1\n${fmtTime(0)} --> ${fmtTime(timing.totalFrames / fps - 0.1)}\n${text}\n\n`
}

// ffprobe the staged clip (real duration + pixel size). Injected in tests.
export function defaultProbeClip(path, execFn = execFileSync) {
  const out = execFn(process.env.FFPROBE_BIN || 'ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:stream_tags=rotate:stream_side_data=rotation:format=duration',
    '-of', 'json', path,
  ], { encoding: 'utf8', timeout: 30000 })
  const j = JSON.parse(out)
  const st = (j.streams ?? [])[0] ?? {}
  // A phone clip is often stored sideways with a rotation flag; the displayed size swaps width and height.
  const rot = Math.abs(Number(st.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? st.tags?.rotate ?? 0)) % 180
  const sideways = rot === 90
  const w = Number(st.width)
  const h = Number(st.height)
  return { durationSec: Number(j.format?.duration), width: sideways ? h : w, height: sideways ? w : h }
}

// Refuse before rendering when the staged clip cannot honour the props: too short for sourceIn + durationSec,
// or a crop whose pixel region is not 9:16. Reports the upscale factor so weak picture quality is visible.
export function assertAtmosphereClipUsable(props, probe) {
  const { durationSec, width, height } = probe
  if (![durationSec, width, height].every((n) => Number.isFinite(n) && n > 0)) {
    throw new RemotionOrderError('氛围片素材读不出时长或分辨率（ffprobe 失败），拒绝出片')
  }
  const need = (props.sourceIn ?? 0) + props.durationSec
  if (need > durationSec + 0.05) {
    throw new RemotionOrderError(`氛围片素材不够长：需要从 ${props.sourceIn ?? 0}s 起连续 ${props.durationSec}s（共 ${need}s），素材只有 ${durationSec.toFixed(2)}s；不循环、不定格`)
  }
  const cw = width * (props.crop?.w ?? 1)
  const ch = height * (props.crop?.h ?? 1)
  if (props.crop && Math.abs(cw / ch - 9 / 16) > 0.03) {
    throw new RemotionOrderError(`氛围片裁剪区域不是 9:16（${cw.toFixed(0)}×${ch.toFixed(0)} 像素），画面会变形`)
  }
  return { source: { durationSec, width, height }, regionPx: { width: Math.round(cw), height: Math.round(ch) }, upscale: Number((1920 / ch).toFixed(2)), quality: 1920 / ch > 1.05 ? 'weak: upscaled' : 'ok' }
}

// Build the SRT captions for the data card: hook, one cue per row, disclaimer held with the last row.
export function buildDatacardSrt(props, timing, fps) {
  const { hook, rows, disclaimer } = buildDatacardText(props)
  const end = timing.totalFrames / fps - 0.1
  const cues = [[0, timing.hookFrames / fps, hook]]
  rows.forEach((text, i) => {
    const last = i === rows.length - 1
    cues.push([timing.rowFrom[i] / fps, last ? end : timing.rowFrom[i + 1] / fps, last ? `${text} · ${disclaimer}` : text])
  })
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
  let outFd
  let copied = 0
  let size
  try {
    const st = fstatSync(fd)
    if (!st.isFile()) throw new Error('not a regular file')
    size = st.size
    outFd = openSync(dest, 'w')
    const chunk = Buffer.alloc(1024 * 1024)
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null)
      if (n === 0) break
      writeSync(outFd, chunk, 0, n)
      copied += n
    }
  } finally {
    closeSync(fd)
    if (outFd !== undefined) closeSync(outFd)
  }
  if (copied !== size) {
    rmSync(dest, { force: true })
    throw new RemotionOrderError(`素材拷贝不完整：${basename(dest)}`)
  }
  const again = realpathSync(srcReal)
  if (again !== srcReal || !isInside(rootReal, again)) {
    rmSync(dest, { force: true })
    throw new Error('source changed during copy')
  }
}

// Dropbox "online-only" files are placeholders: size > 0 but nothing on disk. Reading them makes the client download the file.
const WAKE_ATTEMPTS = 2
const WAKE_DEADLINE_MS = 60_000
const WAKE_CHUNK_BYTES = 1 << 20
const NOT_THERE_CODES = new Set(['ENOENT', 'ENOTDIR'])

export function isCloudOnly(path) {
  try {
    const st = statSync(path)
    return st.isFile() && st.size > 0 && st.blocks === 0
  } catch {
    return false
  }
}

// Read a file end to end (forces a cloud download) with a hard time limit. Never throws.
export function wakeCloudFile(path, { deadlineMs = WAKE_DEADLINE_MS, now = Date.now } = {}) {
  const started = now()
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY)
    const buf = Buffer.alloc(WAKE_CHUNK_BYTES)
    for (;;) {
      if (now() - started > deadlineMs) return { ok: false, reason: `超过 ${Math.round(deadlineMs / 1000)} 秒仍没读完` }
      if (readSync(fd, buf, 0, buf.length, null) === 0) return { ok: true }
    }
  } catch (e) {
    return { ok: false, reason: e.code || e.message }
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// 'missing' = the file is not there; 'unreadable' = it is there but could not be read (cloud-only, I/O error, permissions).
export function classifyStageError(e) {
  if (e instanceof RemotionOrderError) return 'fatal'
  if (e && NOT_THERE_CODES.has(e.code)) return 'missing'
  if (e && e.code === undefined && e.message === 'bad') return 'missing'
  return 'unreadable'
}

// Vocal-free gate on the STAGED music file (the exact bytes that get rendered).
// Fail-closed: unregistered, vocal, or window-not-covered music never renders.
export async function defaultMusicVocalGate({ stagedPath, props, totalFrames, fps, label, registryPath = MUSIC_VOCAL_REGISTRY_PATH }) {
  const registry = loadMusicVocalRegistry(registryPath)
  const sha256 = await sha256File(stagedPath)
  const { startSec, durationSec } = usedWindowFromProps({ musicStartSec: props.musicStartSec, totalFrames, fps })
  return assertMusicVocalClear({ registry, sha256, startSec, durationSec, label })
}

// Templates whose on-screen text, caption and SRT the worker can rescan (see textBuilders below).
export const CONTENT_SUBSTANCE_CAPABILITY = 'content_substance_v1'

// Content-substance gate (fail-closed): a finished video must put real words on screen long enough to stand on
// its own. `deliverable: 'asset_only'` (strict equality, case-sensitive) marks material that is never published;
// anything else, including a mistyped value, is treated as a normal deliverable and must pass.
export function assessContentSubstance(eng, template, remotion, props) {
  if (typeof eng.contentSubstanceOf !== 'function') {
    throw new RemotionOrderError('出片机缺少内容闸（contentSubstanceOf），拒绝出片：请先升级出片机')
  }
  let result
  try {
    result = eng.contentSubstanceOf(template, props)
  } catch (e) {
    // A malformed shape must never turn into a retryable generic error: refuse the order.
    throw new RemotionOrderError(`内容闸检查本身出错，拒绝出片：${String(e?.message ?? e).slice(0, 200)}`)
  }
  if (remotion.deliverable === 'asset_only') {
    return { ...result, verdict: 'asset_only' }
  }
  if (result.verdict !== 'pass') {
    throw new RemotionOrderError(
      `内容闸：整条片屏幕上没有连续可见 ≥2 秒的团名/地点/卖点/品牌卡，不是能单独发布的成片（需改下单参数：加内容，或明确标 deliverable=asset_only 作素材；复活原单无效）。${result.reason}`,
    )
  }
  return result
}

export const TEXT_WIRED_TEMPLATES = ['list', 'montage', 'datacard', 'postcard', 'atmosphere']

// Copy the referenced assets into the staging directory.
export function stageRemotionAssets({ props, files, stageDir, brandkitDir, assetLibDir, clientRootDir, musicPath = null, musicRoot = null, musicFolder = '' }) {
  const hasLogo = typeof props.logoFile === 'string'
  if (hasLogo && !props.logoFile.toLowerCase().endsWith('.png')) {
    throw new RemotionOrderError('logo 文件名必须是 .png（logo 一律取自该客户品牌包的 watermark.png）')
  }
  const lower = files.map((f) => f.toLowerCase())
  if (new Set(lower).size !== lower.length) {
    throw new RemotionOrderError('素材文件名大小写不敏感地重复了，请改名')
  }

  if (hasLogo) {
    const logoDest = join(stageDir, props.logoFile)
    mkdirSync(dirname(logoDest), { recursive: true })
    copyFileSync(join(brandkitDir, 'assets', 'watermark.png'), logoDest)
  }

  if (musicPath !== null) {
    try {
      const musicReal = realpathSync(musicPath)
      const rootReal = realpathSync(musicRoot)
      if (!isInside(rootReal, musicReal) || !statSync(musicReal).isFile()) throw new Error('bad')
      const musicDest = join(stageDir, props.musicFile)
      mkdirSync(dirname(musicDest), { recursive: true })
      copyWithinRoot(musicReal, rootReal, musicDest)
    } catch {
      throw new RemotionOrderError(`乐库里找不到音乐文件：${props.musicFile}（乐库文件夹：${musicFolder}）`)
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
  const unreadable = []
  const stageOne = (name) => {
    const dest = join(stageDir, name)
    const srcReal = realpathSync(resolve(libReal, name))
    if (!isInside(libReal, srcReal) || !statSync(srcReal).isFile()) throw new Error('bad')
    mkdirSync(dirname(dest), { recursive: true })
    copyWithinRoot(srcReal, libReal, dest)
    return srcReal
  }
  for (const name of others) {
    let lastReason = ''
    try {
      stageOne(name)
      continue
    } catch (e) {
      const kind = classifyStageError(e)
      if (kind === 'fatal') throw e
      if (kind === 'missing') { missing.push(name); continue }
      lastReason = e.code || e.message
    }
    let staged = false
    for (let attempt = 1; attempt <= WAKE_ATTEMPTS && !staged; attempt++) {
      const woke = wakeCloudFile(resolve(libReal, name))
      try {
        stageOne(name)
        staged = true
      } catch (e) {
        if (classifyStageError(e) === 'fatal') throw e
        lastReason = woke.ok ? (e.code || e.message) : woke.reason
      }
    }
    if (!staged) unreadable.push(`${name}（${lastReason}）`)
  }
  const problems = []
  if (missing.length > 0) problems.push(`缺少素材文件：${missing.join(', ')}。请放到 ${assetLibDir}`)
  if (unreadable.length > 0) {
    problems.push(`素材文件在目录里但读不出来（不是缺失）：${unreadable.join(', ')}。已尝试唤醒 ${WAKE_ATTEMPTS} 次（每次最多 ${WAKE_DEADLINE_MS / 1000} 秒）仍失败；多半是 Dropbox 仅云端文件没下载下来，或磁盘/权限问题`)
  }
  if (problems.length > 0) throw new RemotionOrderError(problems.join('；'))
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
  aspect = '9:16',
  engineDir = REMOTION_ENGINE_DIR,
  timeoutSec = 600,
  signal,
  env = process.env,
  spawnFn = spawn,
}) {
  return new Promise((resolvePromise) => {
    const argv = [
      join(engineDir, 'render.mjs'),
      '--props', propsFile,
      '--out', outFile,
      '--template', template,
      '--public-dir', publicDir,
      '--timeout-sec', String(timeoutSec),
    ]
    if (aspect !== '9:16') argv.push('--aspect', aspect)
    const child = spawnFn(process.execPath, argv, {
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

// Loaded only after the Node health check. A top-level .ts import breaks Node 20 workers
// that never render Remotion (ERR_UNKNOWN_FILE_EXTENSION).
async function loadAspectContract(engineDir = REMOTION_ENGINE_DIR) {
  return import(pathToFileURL(join(engineDir, 'src', 'video-aspects.ts')).href)
}

function assertUploadSize(size, label) {
  if (size > MAX_UPLOAD_BYTES) throw new RemotionOrderError(oversizeUploadMessage(size, label))
}

// Extra ratios need a claim-time signed URL whose file name matches the aspect.
function aspectUploadSlots(wo, extras, aspects) {
  const rows = Array.isArray(wo.aspect_uploads) ? wo.aspect_uploads : []
  const byAspect = new Map(rows.filter((row) => row && typeof row.aspect === 'string').map((row) => [row.aspect, row]))
  const slots = []
  for (const id of extras) {
    const row = byAspect.get(id)
    const fileName = aspects[id].fileName
    const path = typeof row?.path === 'string' ? row.path : ''
    const signedUrl = typeof row?.signed_url === 'string' ? row.signed_url : ''
    if (!signedUrl || !path.endsWith(`/${fileName}`) || path.includes('..')) {
      throw new RemotionOrderError(`工单要额外画幅 ${id}，但领单响应里没有可用的上传地址`)
    }
    slots.push({ aspect: id, path, signedUrl, width: aspects[id].width, height: aspects[id].height, fileName })
  }
  return slots
}

function assertAspectFile(evidence, slot, expectedSeconds, musicFile) {
  if (evidence.width !== slot.width || evidence.height !== slot.height) {
    if (!Number.isInteger(evidence.width)) {
      throw new RemotionOrderError(`成片体检没过：${slot.aspect} 没测到分辨率（出片机的 ffprobe 可能没装好）`)
    }
    throw new RemotionOrderError(`成片体检没过：${slot.aspect} 分辨率是 ${evidence.width}x${evidence.height}，应为 ${slot.width}x${slot.height}`)
  }
  if (!Number.isFinite(evidence.duration_seconds) || Math.abs(evidence.duration_seconds - expectedSeconds) > 0.5) {
    throw new RemotionOrderError(`成片体检没过：${slot.aspect} 时长 ${evidence.duration_seconds}s 与预期 ${expectedSeconds.toFixed(2)}s 不符`)
  }
  if (musicFile !== null && evidence.audio_stream_present !== true) {
    throw new RemotionOrderError(`成片体检没过：工单配了音乐，但 ${slot.aspect} 成片里没有音轨`)
  }
}

async function renderOneFile({ renderFn, args, hb, deps, timeoutSec }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await renderFn(args)
    hb.assertAlive()
    if (res.code === 0) return
    if (res.code === 124) throw new RemotionOrderError(`渲染超时（超过 ${timeoutSec} 秒）：${lastLines(res)}`)
    if (res.code === 2 || res.code === 3 || res.code === 4) {
      throw new RemotionOrderError(`渲染前检查没过（退出码 ${res.code}）：${lastLines(res)}`)
    }
    if (attempt === 1) {
      deps.log(`remotion 渲染失败（退出码 ${res.code}），重试一次：${lastLines(res)}`)
      continue
    }
    throw new Error('渲染失败（已重试 1 次）：' + lastLines(res))
  }
}

async function renderExtraAspects({ slots, renderFn, baseArgs, outDir, hb, deps, timeoutSec, srtText, expectedSeconds, musicFile }) {
  const delivered = []
  for (const slot of slots) {
    const outFile = join(outDir, slot.fileName)
    // Refresh the claim before each extra file. The sweeper drops a claim 10 minutes
    // after the last heartbeat; one file may already have used most of that window.
    await hb.pulse()
    hb.assertAlive()
    await renderOneFile({ renderFn, args: { ...baseArgs, outFile, aspect: slot.aspect }, hb, deps, timeoutSec })
    const stat = statSync(outFile)
    if (!stat.isFile() || stat.size <= 0) throw new RemotionOrderError(`成片体检没过：${slot.aspect} 渲染产物不存在或为空`)
    assertUploadSize(stat.size, `${slot.aspect} 成片`)
    assertAspectFile(deps.probeMediaEvidenceFn(outFile, srtText), slot, expectedSeconds, musicFile)
    delivered.push({ slot, outFile })
  }
  return delivered
}

// Poll the server while rendering; abort the render on abort/409.
// The interval stays on for the whole order, including extra aspects. pulse()
// refreshes the 10-minute sweeper lease at each file boundary.
function startHeartbeats({ woId, heartbeatFn, intervalMs, log }) {
  const ac = new AbortController()
  let fatal = null
  let running = false
  const beat = async () => {
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
  }
  const timer = setInterval(() => { void beat() }, intervalMs)
  return {
    signal: ac.signal,
    assertAlive: () => {
      if (fatal) throw fatal
    },
    stop: () => clearInterval(timer),
    pulse: beat,
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
  // Claim already took the row. A bad list or a failed extra-file signature is returned
  // on the claim so this worker can fail the order instead of leaving it claimed.
  if (typeof wo.aspect_error === 'string' && wo.aspect_error.length > 0) {
    throw new RemotionOrderError(wo.aspect_error)
  }

  const problems = healthFn()
  if (problems.length > 0) {
    throw new RemotionOrderError('出片机还没装好 Remotion：' + problems.join('；'))
  }
  const aspectContract = await loadAspectContract()
  const aspectPlanned = aspectContract.planWorkOrderAspects(remotion.aspects)
  if (!aspectPlanned.ok) throw new RemotionOrderError(aspectPlanned.message)
  const extraSlots = aspectPlanned.plan.extras.length > 0
    ? aspectUploadSlots(wo, aspectPlanned.plan.extras, aspectContract.ASPECTS)
    : []

  const eng = await loadEngineFn()
  const template = remotion.template
  if (!eng.isTemplateId(template)) {
    throw retryableOrderError(
      `UNKNOWN_TEMPLATE: 不认识的模板 ${JSON.stringify(String(template)).slice(0, 40)}：出片机的模板注册表里没有它。先升级出片机，或检查工单 brief.remotion.template`,
    )
  }
  // Refuse a template the worker has no text/red-line wiring for BEFORE any staging or rendering.
  if (!TEXT_WIRED_TEMPLATES.includes(template)) {
    throw new RemotionOrderError(`出片机没有「${String(template).slice(0, 40)}」模板的文字复扫接线，拒绝出片`)
  }
  let props
  let files
  let timing
  let totalFrames
  let recipeGaps = null
  try {
    const loaded = eng.loadTemplate(template, remotion.props)
    props = loaded.props
    files = loaded.assetFiles
    totalFrames = loaded.totalFrames
    recipeGaps = loaded.recipeGaps ?? null
    timing = template === 'list' ? eng.computeTimingFromProps(props) : null
  } catch (e) {
    throw new RemotionOrderError('工单里的视频参数不合格：' + e.message)
  }
  if (template === 'montage') assertMontageTextVisible(props)
  if (template === 'datacard') {
    assertDatacardTextVisible(props)
    timing = eng.computeDataCardTiming(props)
  }
  if (template === 'postcard') {
    assertPostcardTextVisible(props)
    timing = eng.computePostcardTiming(props)
  }
  if (template === 'atmosphere') {
    assertAtmosphereTextVisible(props)
    timing = eng.computeAtmosphereTiming(props)
  }
  // After the text checks, before any staging, probing, vocal gate or rendering.
  const contentSubstance = assessContentSubstance(eng, template, remotion, props)

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

    let brandkitDir = null
    if (typeof props.logoFile === 'string') {
      try {
        brandkitDir = deps.brandkitFor(wo.client_id)
      } catch (e) {
        throw new RemotionOrderError(e.message)
      }
    }
    const clientFolder = deps.clientStudio[wo.client_id]
    if (!clientFolder) {
      throw new RemotionOrderError(`客户 ${wo.client_id} 没配 studio 目录：在出片机 FACTORY_CLIENT_STUDIO 里加一条映射`)
    }
    const clientRootDir = join(deps.studioRoot, clientFolder)
    const assetLibDir = join(clientRootDir, 'remotion-assets')
    let musicSource = null
    if (props.musicFile) {
      try {
        musicSource = eng.musicSourceFor(props.musicFile)
      } catch (e) {
        throw retryableOrderError('音乐目录读不了：' + e.message)
      }
    }
    if (musicSource && existsSync(join(assetLibDir, props.musicFile))) {
      deps.log(`音乐 ${props.musicFile} 在共享乐库和客户素材库里都有，按乐库版本出片（乐库优先）`)
    }
    const musicRoot = musicSource ? join(deps.studioRoot, musicSource.folder) : null
    const musicPath = musicSource ? join(musicRoot, musicSource.file) : null
    stageRemotionAssets({ props, files, stageDir, brandkitDir, assetLibDir, clientRootDir, musicPath, musicRoot, musicFolder: musicSource ? musicSource.folder : '' })
    hb.assertAlive()

    let vocalGate = null
    if (props.musicFile) {
      const gateFn = deps.musicVocalGateFn ?? defaultMusicVocalGate
      try {
        vocalGate = await gateFn({ stagedPath: join(stageDir, props.musicFile), props, totalFrames, fps: eng.FPS, label: props.musicFile })
      } catch (e) {
        const reason = e instanceof MusicVocalGateError ? `${e.code}: ${e.message}` : `检查本身出错：${e.message}`
        throw new RemotionOrderError('音乐人声检查没过（出片已拦下）：' + reason)
      }
      hb.assertAlive()
    }

    let atmospherePreflight = null
    if (template === 'atmosphere') {
      try {
        atmospherePreflight = assertAtmosphereClipUsable(props, (deps.probeClipFn ?? defaultProbeClip)(join(stageDir, props.clip)))
      } catch (e) {
        if (e instanceof RemotionOrderError) throw e
        throw new RemotionOrderError('氛围片素材检查本身出错：' + e.message)
      }
    }

    const propsFile = join(root, 'props.json')
    writeFileSync(propsFile, JSON.stringify(props, null, 2))
    const finalPath = join(outDir, 'final.mp4')

    await hb.pulse()
    hb.assertAlive()
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
    // Same 48 MB gate as encode-cap.mjs, before any upload. Extras use assertUploadSize too.
    assertUploadSize(stat.size, '成片')
    // Every known template is listed explicitly; an unknown one is refused instead of falling through to montage.
    const textBuilders = {
      list: [() => buildRemotionSrt(props, timing, eng.FPS), () => buildRemotionCaption(props)],
      datacard: [() => buildDatacardSrt(props, timing, eng.FPS), () => buildDatacardCaption(props)],
      postcard: [() => buildPostcardSrt(props, timing, eng.FPS), () => buildPostcardCaption(props)],
      atmosphere: [() => buildAtmosphereSrt(props, timing, eng.FPS), () => buildAtmosphereCaption(props)],
      montage: [() => buildMontageSrt(props, eng.montageFrameOf, eng.FPS), () => buildMontageCaption(props)],
    }
    const builders = Object.hasOwn(textBuilders, template) ? textBuilders[template] : null
    if (builders === null) throw new RemotionOrderError(`出片机没有「${String(template).slice(0, 40)}」模板的文字复扫接线，拒绝出片`)
    const srtText = builders[0]()
    const caption = builders[1]()
    const expectedSeconds = totalFrames / eng.FPS
    const evidence = deps.probeMediaEvidenceFn(finalPath, srtText)
    assertAspectFile(evidence, { aspect: '9:16', width: 1080, height: 1920 }, expectedSeconds, props.musicFile)
    hb.assertAlive()
    const extraRendered = extraSlots.length === 0 ? [] : await renderExtraAspects({
      slots: extraSlots,
      renderFn,
      baseArgs: { propsFile, publicDir: stageDir, tmpDir, template, timeoutSec, signal: hb.signal },
      outDir,
      hb,
      deps,
      timeoutSec,
      srtText,
      expectedSeconds,
      musicFile: props.musicFile,
    })

    const segmentsJson = Buffer.from(
      JSON.stringify({
        engine: 'remotion',
        template,
        music: musicSource
          ? { source: 'catalog', id: musicSource.id, folder: musicSource.folder, file: musicSource.file, status: musicSource.status }
          : (props.musicFile ? { source: 'client_library', file: props.musicFile } : null),
        props,
        music_vocal_gate: vocalGate,
        content_substance: contentSubstance,
        atmosphere_preflight: atmospherePreflight,
        recipe_gaps: recipeGaps,
        render: { attempts, elapsed_s },
        ...(extraRendered.length > 0 ? { aspects: ['9:16', ...extraRendered.map((extra) => extra.slot.aspect)] } : {}),
      }, null, 2),
    )
    await deps.uploadSignedFn(wo.uploads.video.signed_url, readFileSync(finalPath), 'video/mp4')
    hb.assertAlive()
    for (const extra of extraRendered) {
      await deps.uploadSignedFn(extra.slot.signedUrl, readFileSync(extra.outFile), 'video/mp4')
      hb.assertAlive()
    }
    await deps.uploadSignedFn(wo.uploads.segments_json.signed_url, segmentsJson, 'application/json')
    hb.assertAlive()
    await deps.uploadSignedFn(wo.uploads.srt.signed_url, Buffer.from(srtText), 'text/plain')
    hb.assertAlive()

    const r = await deps.completeFn({
      worker_id: deps.workerId,
      video_url: wo.uploads.video.path,
      segments_json_url: wo.uploads.segments_json.path,
      srt_url: wo.uploads.srt.path,
      ...(extraRendered.length > 0
        ? {
            aspect_outputs: [
              { aspect: '9:16', video_url: wo.uploads.video.path },
              ...extraRendered.map((extra) => ({ aspect: extra.slot.aspect, video_url: extra.slot.path })),
            ],
          }
        : {}),
      caption,
      actual_cost_usd: 0,
      new_clips: [],
      media_evidence: {
        ...evidence,
        content_substance: {
          verdict: contentSubstance.verdict,
          kinds: contentSubstance.kinds,
          textSeconds: contentSubstance.textSeconds,
          reason: contentSubstance.reason,
        },
        capabilities: [CONTENT_SUBSTANCE_CAPABILITY],
      },
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
