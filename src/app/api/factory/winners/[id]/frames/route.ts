// POST /api/factory/winners/[id]/frames — 内部账号给一条赢家传骨架截图（逐镜截图，给认赢家的人看）。
//   {action:'sign', count}   → 返回 count 个签名上传网址（winners/<id>/frame-NN.png）
//   {action:'commit', count} → 核对这些文件真的在存储里，再把网址合并写进 performance.frames
// 只碰这一条赢家的截图，不改骨架、不改确认状态。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { loadWinnerRow, mergePerformanceSegment } from '@/lib/factory/winner-decision'

export const dynamic = 'force-dynamic'
const BUCKET = 'content-factory'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_FRAMES = 12

function framePaths(winnerId: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `winners/${winnerId}/frame-${String(i + 1).padStart(2, '0')}.png`)
}

function publicUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`
}

function parseBody(body: unknown): { action: 'sign' | 'commit'; count: number } | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const count = typeof b.count === 'number' ? Math.trunc(b.count) : NaN
  if (!(count >= 1 && count <= MAX_FRAMES)) return null
  return b.action === 'sign' || b.action === 'commit' ? { action: b.action, count } : null
}

async function signAll(paths: string[]) {
  const urls: { path: string; signedUrl: string }[] = []
  for (const path of paths) {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true })
    if (error || !data) throw error ?? new Error('签名失败')
    urls.push({ path, signedUrl: data.signedUrl })
  }
  return urls
}

async function allExist(winnerId: string, paths: string[]): Promise<boolean> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(`winners/${winnerId}`, { limit: 100 })
  if (error || !data) return false
  const names = new Set(data.map((o) => `winners/${winnerId}/${o.name}`))
  return paths.every((p) => names.has(p))
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const admin = await requireGlobalAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'id must be a uuid' }, { status: 400 })

  let parsed: ReturnType<typeof parseBody>
  try {
    parsed = parseBody(await req.json())
  } catch {
    parsed = null
  }
  if (!parsed) return NextResponse.json({ error: `body must be {action:'sign'|'commit', count:1..${MAX_FRAMES}}` }, { status: 400 })

  const row = await loadWinnerRow(supabaseAdmin, params.id)
  if (!row.ok) return NextResponse.json({ error: row.error }, { status: row.status })
  const paths = framePaths(params.id, parsed.count)

  try {
    if (parsed.action === 'sign') return NextResponse.json({ uploads: await signAll(paths) })
    if (!(await allExist(params.id, paths))) {
      return NextResponse.json({ error: '有截图还没传上去，先传完再提交' }, { status: 409 })
    }
    const merged = await mergePerformanceSegment(supabaseAdmin, row.data, 'frames', paths.map(publicUrl), new Date().toISOString())
    return merged.ok
      ? NextResponse.json({ frames: paths.map(publicUrl) })
      : NextResponse.json({ error: merged.error }, { status: merged.status })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
