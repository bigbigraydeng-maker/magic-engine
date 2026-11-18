import JSZip from 'jszip'
import { jpegSize } from './cover'

import { MAX_LOGO_CHARS } from './logo-rules'
export { MAX_LOGO_CHARS, isLogo } from './logo-rules'

export function logoBytes(dataUri: string): { data: Buffer; type: 'png' | 'jpg' } | null {
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUri)
  if (!m) return null
  return { data: Buffer.from(m[2], 'base64'), type: m[1] === 'png' ? 'png' : 'jpg' }
}

/** Width/height of a PNG (IHDR) or JPEG, no image library. */
export function imageSize(buf: Uint8Array): { width: number; height: number } | null {
  const png = buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  if (png) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf)
  return null
}

/** Fit a logo into a box (px), keeping its proportions. */
export function fitLogo(size: { width: number; height: number }, maxW = 170, maxH = 60): { width: number; height: number } {
  const k = Math.min(maxW / size.width, maxH / size.height)
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) }
}

/**
 * Pull the header logos out of an uploaded Word confirmation, in the order they appear
 * (the CTS4270729 original: agent logo, then operator logo). PNG/JPEG only, at most two.
 */
export async function docxHeaderLogos(buf: ArrayBuffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf)
  const out: string[] = []
  const headers = Object.keys(zip.files).filter((f) => /^word\/header\d*\.xml$/.test(f)).sort()
  for (const h of headers) {
    const xml = await zip.file(h)!.async('string')
    const relsFile = zip.file(h.replace('word/', 'word/_rels/') + '.rels')
    if (!relsFile) continue
    const rels = await relsFile.async('string')
    const target = (id: string) => new RegExp(`Id="${id}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${id}"`).exec(rels)
    for (const [, id] of xml.matchAll(/r:embed="([^"]+)"/g)) {
      const m = target(id)
      const path = m && (m[1] || m[2])
      if (!path) continue
      const file = zip.file(`word/${path.replace(/^\.\//, '')}`)
      const ext = path.toLowerCase().split('.').pop()
      const mime = ext === 'png' ? 'png' : ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : null
      if (!file || !mime) continue
      const uri = `data:image/${mime};base64,${await file.async('base64')}`
      if (uri.length <= MAX_LOGO_CHARS && !out.includes(uri)) out.push(uri)
      if (out.length === 2) return out
    }
  }
  return out
}
