/**
 * Read a source file at the PR head for the Ray merge hold.
 *
 * The contents API inlines a body only up to 1MB, and the trial-run reader
 * stops at 64KB. A complete contents body is used as-is, including files over
 * 64KB. When that body is missing, or the contents API says the blob is too
 * large for that endpoint, the git blob API reads the whole file up to 100MB
 * (raw media type once the JSON body is omitted). Over 100MB comes back
 * `null` so the caller can judge the diff. A 404 is that same `null` only
 * when the PR file list marks this path `removed`. Any other 404 — permissions,
 * a stale read, or a rename's old path — is a read failure. A rate limit, 5xx,
 * network error, or that other 404 comes back `FILE_READ_FAILED` so the caller
 * keeps the PR for Ray.
 */

export const FILE_READ_FAILED = Object.freeze({ kind: 'file-read-failed' })

/** Largest blob the GitHub git API will return. */
export const BLOB_READ_CAP = 100 * 1024 * 1024

const SHA_RE = /^[0-9a-f]{40}$/i

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isFileReadFailure(value) {
  return Boolean(value) && typeof value === 'object' && /** @type {{kind?: unknown}} */ (value).kind === 'file-read-failed'
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function blobSha(value) {
  return typeof value === 'string' && SHA_RE.test(value) ? value : null
}

/**
 * @param {unknown} json
 * @returns {number|null}
 */
function byteSize(json) {
  if (!json || typeof json !== 'object') return null
  const size = Number(/** @type {{size?: unknown}} */ (json).size)
  return Number.isFinite(size) && size >= 0 ? size : null
}

/**
 * @param {unknown} json
 * @returns {string|null}
 */
function shaOf(json) {
  if (!json || typeof json !== 'object') return null
  return blobSha(/** @type {{sha?: unknown}} */ (json).sha)
}

/**
 * @param {string} content
 * @returns {Buffer}
 */
function decodeBase64(content) {
  return Buffer.from(content.replace(/\s/g, ''), 'base64')
}

/**
 * Full text when the base64 body is the whole file and within the blob cap.
 *
 * @param {unknown} json
 * @returns {string|null}
 */
function completeText(json) {
  if (!json || typeof json !== 'object') return null
  const row = /** @type {{encoding?: unknown, content?: unknown}} */ (json)
  if (row.encoding !== 'base64' || typeof row.content !== 'string') return null
  const buf = decodeBase64(row.content)
  const size = byteSize(json)
  if (size === null) return buf.length <= BLOB_READ_CAP ? buf.toString('utf8') : null
  if (buf.length !== size || size > BLOB_READ_CAP) return null
  return buf.toString('utf8')
}

/**
 * @param {unknown} json
 * @param {string|undefined} text
 * @returns {string}
 */
function errorText(json, text) {
  const message =
    json && typeof json === 'object' && typeof /** @type {{message?: unknown}} */ (json).message === 'string'
      ? /** @type {{message: string}} */ (json).message
      : ''
  const codes = []
  const errors = json && typeof json === 'object' ? /** @type {{errors?: unknown}} */ (json).errors : null
  if (Array.isArray(errors)) {
    for (const item of errors) {
      if (item && typeof item === 'object' && typeof /** @type {{code?: unknown}} */ (item).code === 'string') {
        codes.push(/** @type {{code: string}} */ (item).code)
      }
    }
  }
  return `${message}\n${codes.join(' ')}\n${text ?? ''}`.toLowerCase()
}

/**
 * @param {number} status
 * @param {unknown} json
 * @param {string|undefined} text
 * @returns {boolean}
 */
function isTooLarge(status, json, text) {
  if (status !== 403 && status !== 422) return false
  const body = errorText(json, text)
  return body.includes('too_large') || body.includes('too large')
}

/**
 * @param {number} status
 * @param {unknown} json
 * @param {string|undefined} text
 * @returns {boolean}
 */
function isRateLimited(status, json, text) {
  if (status === 429) return true
  return errorText(json, text).includes('rate limit')
}

/**
 * @param {unknown} json
 * @returns {boolean}
 */
function isContentFile(json) {
  return Boolean(json) && typeof json === 'object' && /** @type {{type?: unknown}} */ (json).type === 'file'
}

/**
 * @param {string|undefined} text
 * @returns {{kind:'text', text:string}|{kind:'too-big'}|{kind:'failed'}}
 */
function classifyRaw(text) {
  if (typeof text !== 'string') return { kind: 'failed' }
  if (Buffer.byteLength(text) > BLOB_READ_CAP) return { kind: 'too-big' }
  return { kind: 'text', text }
}

/**
 * @param {{phase:string, json?:unknown, text?:string}} input
 * @param {string|null} known
 * @returns {{kind:'text', text:string}|{kind:'need-blob', sha:string}|{kind:'need-raw', sha:string}|{kind:'too-big'}|{kind:'missing'}|{kind:'failed'}}
 */
function classifyOkBody(input, known) {
  if (input.phase === 'raw') return classifyRaw(input.text)
  const size = byteSize(input.json)
  if (size !== null && size > BLOB_READ_CAP) return { kind: 'too-big' }
  if (input.phase === 'contents' && !isContentFile(input.json)) {
    return known ? { kind: 'need-blob', sha: known } : { kind: 'failed' }
  }
  const text = completeText(input.json)
  if (text !== null) return { kind: 'text', text }
  if (!known) return { kind: 'failed' }
  return input.phase === 'contents' ? { kind: 'need-blob', sha: known } : { kind: 'need-raw', sha: known }
}

/**
 * What one GitHub response means for the Ray-hold read.
 *
 * @param {{phase:'contents'|'blob'|'raw', status:number, json?:unknown, text?:string, knownSha?:string, removed?:boolean}} input
 * @returns {{kind:'text', text:string}|{kind:'need-blob', sha:string}|{kind:'need-raw', sha:string}|{kind:'too-big'}|{kind:'missing'}|{kind:'failed'}}
 */
export function classifyRayHoldResponse(input) {
  const known = blobSha(input.knownSha) || shaOf(input.json)
  // Trust a 404 only for the contents read of a path the file list marks removed.
  // A blob 404, or a 404 on a file that is still supposed to be at this ref, is a failure.
  if (input.status === 404) {
    return input.phase === 'contents' && input.removed === true ? { kind: 'missing' } : { kind: 'failed' }
  }
  if (input.status === 0 || input.status >= 500 || isRateLimited(input.status, input.json, input.text)) {
    return { kind: 'failed' }
  }
  if (isTooLarge(input.status, input.json, input.text)) {
    if (input.phase === 'contents' && known) return { kind: 'need-blob', sha: known }
    return { kind: 'too-big' }
  }
  if (input.status !== 200) return { kind: 'failed' }
  return classifyOkBody(input, known)
}

/**
 * @typedef {(url: string, init?: {headers?: Record<string, string>}) => Promise<{status: number, text: () => Promise<string>}>} RayFetch
 */

/**
 * @param {RayFetch} fetchImpl
 * @param {string} path
 * @param {string} token
 * @param {boolean} raw
 */
async function githubGet(fetchImpl, path, token, raw) {
  try {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    const text = await res.text()
    if (raw) return { status: res.status, text, json: /** @type {unknown} */ (null) }
    let json = /** @type {unknown} */ (null)
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
    }
    return { status: res.status, text, json }
  } catch (err) {
    return { status: 0, text: err instanceof Error ? err.message : String(err), json: null }
  }
}

/**
 * @param {{kind:string, text?:string, sha?:string}} step
 * @param {RayFetch} fetchImpl
 * @param {string} repository
 * @param {string} token
 */
async function followBlob(step, fetchImpl, repository, token) {
  if (step.kind === 'need-blob') {
    const blob = await githubGet(fetchImpl, `/repos/${repository}/git/blobs/${step.sha}`, token, false)
    step = classifyRayHoldResponse({
      phase: 'blob',
      status: blob.status,
      json: blob.json,
      text: blob.text,
      knownSha: step.sha,
    })
  }
  if (step.kind === 'need-raw') {
    const raw = await githubGet(fetchImpl, `/repos/${repository}/git/blobs/${step.sha}`, token, true)
    step = classifyRayHoldResponse({
      phase: 'raw',
      status: raw.status,
      json: raw.json,
      text: raw.text,
      knownSha: step.sha,
    })
  }
  return step
}

/**
 * @param {{kind:string, text?:string}} step
 * @returns {string|null|typeof FILE_READ_FAILED}
 */
function finishRead(step) {
  if (step.kind === 'text' && typeof step.text === 'string') return step.text
  if (step.kind === 'failed') return FILE_READ_FAILED
  return null
}

/**
 * Read one source file. String = whole file. `null` = too big, or a 404 on a
 * path the PR list marks removed (caller may use the diff).
 * `FILE_READ_FAILED` = the API failed, including any other 404.
 *
 * @param {{repository:string, path:string, ref:string, token:string, sha?:string, removed?:boolean, fetchImpl?: RayFetch}} input
 * @returns {Promise<string|null|typeof FILE_READ_FAILED>}
 */
export async function readRayHoldFile(input) {
  const fetchImpl = input.fetchImpl ?? /** @type {RayFetch} */ (fetch)
  const encoded = input.path.split('/').map(encodeURIComponent).join('/')
  const ref = encodeURIComponent(input.ref)
  const contents = await githubGet(
    fetchImpl,
    `/repos/${input.repository}/contents/${encoded}?ref=${ref}`,
    input.token,
    false,
  )
  const step = await followBlob(
    classifyRayHoldResponse({
      phase: 'contents',
      status: contents.status,
      json: contents.json,
      text: contents.text,
      knownSha: input.sha,
      removed: input.removed === true,
    }),
    fetchImpl,
    input.repository,
    input.token,
  )
  if (step.kind === 'need-blob' || step.kind === 'need-raw') return FILE_READ_FAILED
  return finishRead(step)
}

/**
 * @param {unknown} files
 * @returns {Array<{path:string, sha?:string, removed?:boolean}>}
 */
function sourceJobs(files) {
  /** @type {Array<{path:string, sha?:string, removed?:boolean}>} */
  const jobs = []
  const seen = new Set()
  if (!Array.isArray(files)) return jobs
  for (const entry of files) {
    if (!entry || typeof entry !== 'object') continue
    const record = /** @type {Record<string, unknown>} */ (entry)
    for (const key of ['filename', 'previous_filename']) {
      const filename = record[key]
      if (typeof filename !== 'string' || !/\.(?:ts|tsx|js|mjs|cjs)$/i.test(filename)) continue
      if (seen.has(filename)) continue
      seen.add(filename)
      const sha = key === 'filename' ? blobSha(record.sha) : null
      const removed = key === 'filename' && record.status === 'removed'
      jobs.push(sha ? { path: filename, sha, removed } : { path: filename, removed })
    }
  }
  return jobs
}

/**
 * @param {{files: unknown, repository: string, ref: string, token: string, fetchImpl?: RayFetch}} input
 * @returns {Promise<Record<string, string|null|typeof FILE_READ_FAILED>>}
 */
export async function readRayHoldFiles(input) {
  /** @type {Record<string, string|null|typeof FILE_READ_FAILED>} */
  const out = {}
  for (const job of sourceJobs(input.files)) {
    out[job.path] = await readRayHoldFile({
      repository: input.repository,
      path: job.path,
      ref: input.ref,
      token: input.token,
      sha: job.sha,
      removed: job.removed,
      fetchImpl: input.fetchImpl,
    })
  }
  return out
}
