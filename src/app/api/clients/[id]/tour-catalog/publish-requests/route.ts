import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireCatalogAccess } from '@/lib/tour-catalog/access'
import { asPlainObject, readJsonBody } from '@/lib/tour-catalog/http'
import { upsertPublishRequest } from '@/lib/tour-catalog/store-access'
import { getDraftRevision } from '@/lib/tour-catalog/store'
import type { PublishRequestView } from '@/lib/tour-catalog/catalog-contract'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: Promise<{ id: string }>
}

const MAX_NOTE_LENGTH = 500
/** Control characters, zero-width and bidi-override characters are refused outright. */
const FORBIDDEN_NOTE_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/

type NoteResult = { ok: true; note: string } | { ok: false }

function readNote(body: unknown): NoteResult {
  const raw = asPlainObject(body)?.note
  if (raw === undefined) return { ok: true, note: '' }
  if (typeof raw !== 'string') return { ok: false }
  const note = raw.trim()
  if (note.length > MAX_NOTE_LENGTH || FORBIDDEN_NOTE_RE.test(note)) return { ok: false }
  return { ok: true, note }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const { id: clientId } = await params

  const access = await requireCatalogAccess(clientId, 'request_publish')
  if (!access.ok) return access.response

  const read = await readJsonBody(req)
  if (!read.ok) return read.response

  const parsed = readNote(read.body)
  if (!parsed.ok) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  try {
    const draftVersion = await getDraftRevision(supabaseAdmin, clientId)
    const request = await upsertPublishRequest(
      supabaseAdmin,
      clientId,
      access.actor,
      draftVersion,
      parsed.note,
    )
    return NextResponse.json<{ request: PublishRequestView }>({ request })
  } catch (err) {
    console.error('publish_request_failed', err)
    return NextResponse.json({ error: 'request_failed' }, { status: 500 })
  }
}
