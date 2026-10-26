// Fail-closed gate: refuse to render music whose SHA-256 is not registered
// as vocal-free for the time window actually used. Registry JSON is the only input.

import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'

const SHA_RE = /^[0-9a-f]{64}$/
const SIGNED_BY_RE = /^(PM审片@[0-9a-f]{8,}|human:.+)$/
const VERDICTS = new Set(['none', 'present', 'unknown'])
const STRENGTHS = new Set(['signed', 'approval-only'])
const ENTRY_KEYS = new Set([
  'sha256', 'name', 'verdict', 'cleanUntilSec', 'strength',
  'derivedFrom', 'signedBy', 'signedAt', 'evidence',
])

export class MusicVocalGateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MusicVocalGateError'
    this.code = code
  }
}

function invalid(msg) {
  return new MusicVocalGateError('MUSIC_VOCAL_REGISTRY_INVALID', msg)
}

function validateEntry(entry, index) {
  const at = `registry[${index}]`
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw invalid(`${at} 必须是对象`)
  }
  for (const key of Object.keys(entry)) {
    if (!ENTRY_KEYS.has(key)) throw invalid(`${at} 含未知字段 ${key}`)
  }
  if (typeof entry.sha256 !== 'string' || !SHA_RE.test(entry.sha256)) {
    throw invalid(`${at}.sha256 必须是 64 位小写 hex`)
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') {
    throw invalid(`${at}.name 必须是非空字符串`)
  }
  if (!VERDICTS.has(entry.verdict)) {
    throw invalid(`${at}.verdict 必须是 none/present/unknown`)
  }
  if (entry.strength !== undefined && !STRENGTHS.has(entry.strength)) {
    throw invalid(`${at}.strength 必须是 signed/approval-only`)
  }
  if (entry.derivedFrom !== undefined && (typeof entry.derivedFrom !== 'string' || !SHA_RE.test(entry.derivedFrom))) {
    throw invalid(`${at}.derivedFrom 必须是 64 位小写 hex`)
  }
  if (entry.cleanUntilSec !== undefined) {
    if (entry.verdict === 'present') throw invalid(`${at} verdict=present 不允许 cleanUntilSec`)
    if (typeof entry.cleanUntilSec !== 'number' || !Number.isFinite(entry.cleanUntilSec) || entry.cleanUntilSec < 0) {
      throw invalid(`${at}.cleanUntilSec 必须是 >= 0 的有限数字`)
    }
  }
  if (typeof entry.signedBy !== 'string' || entry.signedBy.trim() === '') {
    throw invalid(`${at}.signedBy 必须是非空字符串`)
  }
  if (entry.verdict !== 'present' && !SIGNED_BY_RE.test(entry.signedBy)) {
    throw invalid(`${at}.signedBy 必须是真人(PM审片@<hex8+> 或 human:<id>),不接受自由文本`)
  }
  if (typeof entry.signedAt !== 'string' || Number.isNaN(Date.parse(entry.signedAt))) {
    throw invalid(`${at}.signedAt 必须是 ISO-8601 字符串`)
  }
  if (typeof entry.evidence !== 'string' || entry.evidence.trim() === '') {
    throw invalid(`${at}.evidence 必须是非空字符串`)
  }
}

export function parseMusicVocalRegistry(raw) {
  if (!Array.isArray(raw)) throw invalid('registry 必须是数组')
  const seen = new Set()
  raw.forEach((entry, index) => {
    validateEntry(entry, index)
    if (seen.has(entry.sha256)) throw invalid(`registry[${index}] sha256 重复: ${entry.sha256}`)
    seen.add(entry.sha256)
  })
  return raw
}

export function loadMusicVocalRegistry(path, { readFileFn = readFileSync } = {}) {
  let text
  try {
    text = readFileFn(path, 'utf8')
  } catch (err) {
    throw invalid(`无法读取 registry ${path}: ${err.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw invalid(`registry JSON 解析失败 ${path}: ${err.message}`)
  }
  return parseMusicVocalRegistry(parsed)
}

export function sha256File(path, { createReadStreamFn = createReadStream } = {}) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStreamFn(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function assertWindowArgs(startSec, durationSec) {
  if (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0) {
    throw new TypeError('startSec 必须是 >= 0 的有限数字')
  }
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new TypeError('durationSec 必须是 > 0 的有限数字')
  }
}

export function assertMusicVocalClear({
  registry, sha256, startSec, durationSec, marginSec = 1, label = '',
}) {
  assertWindowArgs(startSec, durationSec)
  if (typeof marginSec !== 'number' || !Number.isFinite(marginSec) || marginSec < 0) {
    throw new TypeError('marginSec 必须是 >= 0 的有限数字')
  }
  const where = label ? `(${label})` : ''
  const entry = registry.find((e) => e.sha256 === sha256)
  if (!entry) {
    throw new MusicVocalGateError(
      'MUSIC_VOCAL_UNREGISTERED',
      `音乐未登记${where}: ${sha256}。先跑人声扫描并由真人签字登记`,
    )
  }
  if (entry.verdict === 'present') {
    throw new MusicVocalGateError(
      'MUSIC_VOCAL_PRESENT',
      `音乐含人声${where}: ${entry.name}。换无人声 BGM 或重新登记`,
    )
  }
  const needsCleanUntil = entry.verdict === 'unknown' || entry.cleanUntilSec !== undefined
  if (needsCleanUntil) {
    const limit = entry.cleanUntilSec
    const required = startSec + durationSec + marginSec
    if (limit === undefined || required > limit) {
      throw new MusicVocalGateError(
        'MUSIC_VOCAL_UNKNOWN',
        `人声窗口未覆盖${where}: 需要 ${required}s,已核验 ${limit ?? '无'}s。补扫并重新签字`,
      )
    }
  }
  return {
    sha256,
    verdict: entry.verdict,
    strength: entry.strength ?? 'signed',
    name: entry.name,
    window: [startSec, startSec + durationSec],
    cleanUntilSec: entry.cleanUntilSec ?? null,
  }
}

export function usedWindowFromProps({ musicStartSec, totalFrames, fps }) {
  if (typeof totalFrames !== 'number' || !Number.isFinite(totalFrames) || totalFrames <= 0) {
    throw new TypeError('totalFrames 必须是 > 0 的有限数字')
  }
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    throw new TypeError('fps 必须是 > 0 的有限数字')
  }
  const startSec = musicStartSec ?? 0
  if (typeof startSec !== 'number' || !Number.isFinite(startSec) || startSec < 0) {
    throw new TypeError('musicStartSec 必须是 >= 0 的有限数字')
  }
  return { startSec, durationSec: totalFrames / fps }
}

// Conservative window for dormant legacy/recipe paths (no staged props to derive it from):
// the whole first 60 s of the file must be verified vocal-free.
export const LEGACY_BGM_WINDOW_SEC = 60

export function assertBgmFileVocalClear(path, registryPath, { label = '', readFileFn = readFileSync } = {}) {
  const registry = loadMusicVocalRegistry(registryPath, { readFileFn })
  const sha256 = createHash('sha256').update(readFileFn(path)).digest('hex')
  return assertMusicVocalClear({ registry, sha256, startSec: 0, durationSec: LEGACY_BGM_WINDOW_SEC, marginSec: 0, label })
}

// Legacy `assemble` rule in one testable place: a file BGM must be registered vocal-free; a
// mood-only request lets make_promo pick a track we cannot see, so it is refused; no music and
// no mood means make_promo renders without a music bed (verified in make_promo.py), so it passes.
export function assertLegacyBgmVocalGate({ bgm, musicMood, registryPath, readFileFn = readFileSync }) {
  if (bgm) return assertBgmFileVocalClear(bgm, registryPath, { label: 'legacy', readFileFn })
  if (musicMood) {
    throw new MusicVocalGateError(
      'MUSIC_VOCAL_UNREGISTERED',
      'music_mood 由出片程序自选曲，选中的文件无法在出片前核验人声；请改成指定曲目并先登记',
    )
  }
  return null
}
