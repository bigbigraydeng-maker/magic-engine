import { readLimitedBody } from '@/lib/uploads/read-limited-body'

/**
 * Parse a multipart upload with a hard byte limit applied BEFORE the body is buffered:
 * a declared Content-Length over the limit is refused up front, and a body that arrives
 * without a length (chunked) is counted while it is read.
 */

export type FormDataResult =
  | { ok: true; form: FormData }
  | { ok: false; status: 400 | 413; error: string }

const TOO_BIG: FormDataResult = { ok: false, status: 413, error: '文件太大，单个文件最大 50 MB' }

export async function boundedFormData(req: Request, limit: number): Promise<FormDataResult> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > limit) return TOO_BIG

  let source: Request = req
  if (!declared && req.body) {
    const bytes = await readLimitedBody(req.body, limit)
    if (!bytes) return TOO_BIG
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    source = new Request(req.url, { method: req.method, headers: req.headers, body })
  }

  try {
    return { ok: true, form: await source.formData() }
  } catch {
    return { ok: false, status: 400, error: '上传表单无效' }
  }
}
