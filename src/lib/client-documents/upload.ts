import { randomUUID } from 'node:crypto'
import { MAX_DOCUMENT_BYTES } from './constants'
import { checkUploadedFile, type CheckedFile } from './files'
import { parseUploadFields, type UploadFields } from './input'
import { buildStoragePath, removeDocumentFile, uploadDocumentFile } from './storage'
import {
  archiveCurrentDocument,
  clientExists,
  findCurrentByHash,
  getCurrentDocument,
  getDocumentById,
  insertDocument,
  type StoreFailure,
} from './store'

/**
 * One upload, start to finish: check the file and the fields, refuse duplicates, store the file,
 * write the row, and (for "replace with a new version") archive the old row.
 *
 * Order matters: the file goes up first and is removed again if the row definitely was not written,
 * so a row never points at a missing file. A leftover file with no row cannot be downloaded.
 * When the database answers with an error that carries no SQLSTATE (timeout, dropped connection),
 * the row may have been written anyway: the row is looked up first, and the file is only removed
 * when the row is confirmed absent. If even that lookup fails, the file is kept and its path logged.
 */

export interface UploadOutcome {
  status: 201 | 400 | 404 | 409 | 413 | 500
  body: Record<string, unknown>
}

interface Prepared {
  file: CheckedFile
  bytes: Buffer
  fields: UploadFields
}

function refuse(status: UploadOutcome['status'], error: string, code?: string): UploadOutcome {
  return { status, body: code ? { error, code } : { error } }
}

const UNAVAILABLE = refuse(500, '资料库暂时不可用，请稍后再试', 'client_documents_unavailable')

async function prepareUpload(form: FormData): Promise<Prepared | UploadOutcome> {
  const entry = form.get('file')
  if (entry === null || typeof entry === 'string') return refuse(400, '请选择要上传的文件')
  if (entry.size > MAX_DOCUMENT_BYTES) return refuse(413, '单个文件最大 50 MB')

  const bytes = Buffer.from(await entry.arrayBuffer())
  const checked = checkUploadedFile(entry.name, bytes)
  if (!checked.ok) return refuse(checked.status, checked.error)

  const fallbackTitle = checked.file.displayName.replace(/\.[^.]+$/, '')
  const fields = parseUploadFields(form, fallbackTitle)
  if (!fields.ok) return refuse(400, fields.error)
  return { file: checked.file, bytes, fields: fields.value }
}

/** Everything that can say "no" before a byte is stored. Null = go ahead. */
async function precheck(clientId: string, prepared: Prepared): Promise<UploadOutcome | null> {
  const exists = await clientExists(clientId)
  if (!exists.ok) return UNAVAILABLE
  if (!exists.data) return refuse(404, '客户不存在')

  const { replaceId } = prepared.fields
  if (replaceId) {
    const target = await getCurrentDocument(clientId, replaceId)
    if (!target.ok) return UNAVAILABLE
    if (!target.data) return refuse(404, '要替换的文件不存在，或已经是旧版')
  }

  const same = await findCurrentByHash(clientId, prepared.file.sha256)
  if (!same.ok) return UNAVAILABLE
  if (same.data) {
    return refuse(409, `资料库里已经有内容完全相同的现行文件：「${same.data.title}」`, 'duplicate_content')
  }
  return null
}

async function storeFileAndRow(clientId: string, prepared: Prepared, actor: string): Promise<UploadOutcome> {
  const { file, bytes, fields } = prepared
  const docId = randomUUID()
  const path = buildStoragePath(clientId, docId, file.storageName)

  const uploadError = await uploadDocumentFile(path, bytes, file.mimeType)
  if (uploadError) {
    console.error('[client-documents/upload] storage upload failed', clientId, uploadError)
    return UNAVAILABLE
  }

  const inserted = await insertDocument({
    id: docId,
    client_id: clientId,
    category: fields.category,
    title: fields.title,
    description: fields.description,
    version_label: fields.versionLabel,
    visibility: fields.visibility,
    storage_path: path,
    original_filename: file.displayName,
    mime_type: file.mimeType,
    size_bytes: file.sizeBytes,
    sha256: file.sha256,
    uploaded_by: actor,
    replaces_id: fields.replaceId,
  })
  if (!inserted.ok) return recoverFromInsertFailure(clientId, docId, path, inserted)
  return { status: 201, body: { document: inserted.data } }
}

async function recoverFromInsertFailure(
  clientId: string,
  docId: string,
  path: string,
  failure: StoreFailure,
): Promise<UploadOutcome> {
  if (failure.ambiguous) {
    const found = await getDocumentById(clientId, docId)
    if (found.ok && found.data) return { status: 201, body: { document: found.data } }
    if (!found.ok) {
      console.error('[client-documents/upload] could not confirm whether the row was saved; file kept at', path)
      return UNAVAILABLE
    }
  }
  await removeDocumentFile(path)
  return failure.duplicate
    ? refuse(409, '资料库里已经有内容完全相同的现行文件', 'duplicate_content')
    : UNAVAILABLE
}

export async function saveUploadedDocument(params: {
  clientId: string
  form: FormData
  actor: string
}): Promise<UploadOutcome> {
  const prepared = await prepareUpload(params.form)
  if ('status' in prepared) return prepared

  const blocked = await precheck(params.clientId, prepared)
  if (blocked) return blocked

  const saved = await storeFileAndRow(params.clientId, prepared, params.actor)
  const { replaceId } = prepared.fields
  if (saved.status !== 201 || !replaceId) return saved

  const archived = await archiveCurrentDocument(params.clientId, replaceId, params.actor)
  if (archived.ok) return saved
  return {
    status: 201,
    body: { ...saved.body, warning: '新版已放进资料库，但旧版没能自动收起，请在页面上手动归档旧版' },
  }
}
