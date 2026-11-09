// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MAX_DOCUMENT_BYTES } from '../constants'
import {
  checkUploadedFile,
  cleanDisplayName,
  extensionOf,
  hasValidSignature,
  isAllowedExtension,
  safeStorageName,
} from '../files'

const PDF = Buffer.from('%PDF-1.7\nbody')
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
const STORAGE_NAME_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$/

describe('extensionOf / isAllowedExtension', () => {
  it('reads the last extension, lower-cased', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf')
    expect(extensionOf('a.tar.gz')).toBe('gz')
    expect(extensionOf('noext')).toBe('')
    expect(extensionOf('.pdf')).toBe('pdf')
  })

  it('only allows the seven document and image types', () => {
    for (const ext of ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg', 'webp']) {
      expect(isAllowedExtension(ext)).toBe(true)
    }
    for (const ext of ['exe', 'html', 'svg', 'zip', 'js', 'doc', 'xls', 'ppt', '', 'constructor', 'toString']) {
      expect(isAllowedExtension(ext)).toBe(false)
    }
  })
})

describe('hasValidSignature', () => {
  it('accepts the real header of each type', () => {
    expect(hasValidSignature('pdf', PDF)).toBe(true)
    expect(hasValidSignature('docx', ZIP)).toBe(true)
    expect(hasValidSignature('xlsx', ZIP)).toBe(true)
    expect(hasValidSignature('pptx', ZIP)).toBe(true)
    expect(hasValidSignature('png', PNG)).toBe(true)
    expect(hasValidSignature('jpg', JPEG)).toBe(true)
    expect(hasValidSignature('jpeg', JPEG)).toBe(true)
    expect(hasValidSignature('webp', WEBP)).toBe(true)
  })

  it('rejects another type\'s header and too-short input', () => {
    expect(hasValidSignature('pdf', PNG)).toBe(false)
    expect(hasValidSignature('png', PDF)).toBe(false)
    expect(hasValidSignature('docx', PDF)).toBe(false)
    expect(hasValidSignature('jpg', PNG)).toBe(false)
    expect(hasValidSignature('webp', Buffer.from('RIFF'))).toBe(false)
    expect(hasValidSignature('pdf', Buffer.from('%PD'))).toBe(false)
    expect(hasValidSignature('png', Buffer.from([0x89, 0x50]))).toBe(false)
    expect(hasValidSignature('docx', Buffer.from([0x50, 0x4b]))).toBe(false)
  })

  it('does not accept a PDF header that is not at byte 0', () => {
    expect(hasValidSignature('pdf', Buffer.from('<html>%PDF-1.7'))).toBe(false)
  })
})

describe('names', () => {
  it('drops directories and unsafe characters but keeps the readable name', () => {
    expect(cleanDisplayName('../../etc/passwd.pdf', 'pdf')).toBe('passwd.pdf')
    expect(cleanDisplayName('C:\\Users\\x\\Best "of" China?.PDF', 'pdf')).toBe('Best of China.pdf')
    expect(cleanDisplayName('中国手册 v11.pdf', 'pdf')).toBe('中国手册 v11.pdf')
    expect(cleanDisplayName('a\u0000b\nc.pdf', 'pdf')).toBe('abc.pdf')
    expect(cleanDisplayName('.pdf', 'pdf')).toBe('file.pdf')
  })

  it('caps the display name length', () => {
    expect(cleanDisplayName(`${'x'.repeat(400)}.pdf`, 'pdf').length).toBeLessThanOrEqual(194)
  })

  it('makes an ASCII storage name that fits the database path rule', () => {
    const samples = [
      'Best of China (v11).pdf',
      '中国手册.pdf',
      '../../evil.pdf',
      '.pdf',
      'a b  c.pdf',
      `${'x'.repeat(400)}.pdf`,
      '---.pdf',
      '___.pdf',
    ]
    for (const sample of samples) {
      const name = safeStorageName(sample, 'pdf')
      expect(name).toMatch(STORAGE_NAME_SEGMENT)
      expect(name).not.toContain('..')
      expect(name.endsWith('.pdf')).toBe(true)
    }
    expect(safeStorageName('Best of China (v11).pdf', 'pdf')).toBe('Best_of_China_v11.pdf')
    expect(safeStorageName('中国手册.pdf', 'pdf')).toBe('file.pdf')
  })
})

describe('checkUploadedFile', () => {
  it('accepts a real PDF and reports its type, size and fingerprint', () => {
    const result = checkUploadedFile('CTS Brochure v11.PDF', PDF)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.file).toMatchObject({
      extension: 'pdf',
      mimeType: 'application/pdf',
      displayName: 'CTS Brochure v11.pdf',
      storageName: 'CTS_Brochure_v11.pdf',
      sizeBytes: PDF.length,
    })
    expect(result.file.sha256).toBe(createHash('sha256').update(PDF).digest('hex'))
  })

  it('refuses an empty file', () => {
    expect(checkUploadedFile('a.pdf', Buffer.alloc(0))).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a file over 50 MB with 413, and accepts exactly 50 MB of valid content', () => {
    const tooBig = Buffer.alloc(MAX_DOCUMENT_BYTES + 1)
    PDF.copy(tooBig)
    expect(checkUploadedFile('big.pdf', tooBig)).toMatchObject({ ok: false, status: 413 })

    const exact = Buffer.alloc(MAX_DOCUMENT_BYTES)
    PDF.copy(exact)
    expect(checkUploadedFile('exact.pdf', exact).ok).toBe(true)
  })

  it('refuses types that are not on the list, whatever the content', () => {
    for (const name of ['run.exe', 'page.html', 'logo.svg', 'bundle.zip', 'script.js', 'noext', 'old.doc']) {
      expect(checkUploadedFile(name, PDF)).toMatchObject({ ok: false, status: 400 })
    }
    expect(checkUploadedFile('evil.pdf.exe', PDF)).toMatchObject({ ok: false, status: 400 })
  })

  it('refuses a file whose content does not match its extension', () => {
    expect(checkUploadedFile('photo.png', PDF)).toMatchObject({ ok: false, status: 400 })
    expect(checkUploadedFile('report.pdf', PNG)).toMatchObject({ ok: false, status: 400 })
    expect(checkUploadedFile('sheet.xlsx', Buffer.from('<html></html>'))).toMatchObject({ ok: false, status: 400 })
  })

  it('treats a double-extension name by its real last extension', () => {
    const result = checkUploadedFile('invoice.exe.pdf', PDF)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.file.mimeType).toBe('application/pdf')
  })
})
