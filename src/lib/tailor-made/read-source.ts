import JSZip from 'jszip'

/**
 * 把顾问上传的行程文件读成纯文本，交给既有的 AI 抽取链。
 *
 * 甲方的行程文件三种格式都有：Word、PDF、纯文本。三种走同一条出口 ——
 * 抽取逻辑只认文本，格式差异全部消化在这里。
 *
 * PDF 不在这里处理：它直接以 document 形式喂给 Claude（见 flights.ts），
 * 那样版式信息不丢，表格类的行程单解析质量明显更好。
 */

export type SourceKind = 'docx' | 'pdf' | 'text'

export function detectKind(filename: string, mime?: string): SourceKind | null {
  const n = filename.toLowerCase()
  if (n.endsWith('.docx') || mime?.includes('wordprocessingml')) return 'docx'
  if (n.endsWith('.pdf') || mime === 'application/pdf') return 'pdf'
  if (/\.(txt|md|rtf|csv)$/.test(n) || mime?.startsWith('text/')) return 'text'
  // 老式 .doc 是二进制复合文档，不是 zip，读不了
  if (n.endsWith('.doc')) return null
  return null
}

/**
 * 从 .docx 里抽文本。
 *
 * docx 就是个 zip，正文在 word/document.xml。不引 mammoth 之类的重库 ——
 * 我们只要纯文本，不需要保留样式，而 jszip 本来就在依赖树里。
 *
 * 关键是**保住段落和表格单元格的边界**：行程 Word 十有八九是张表格
 * （甲方那份就是「Day / Route / Highlights / Overnight」四列），
 * 把标签全剥掉会让「Day 10」和它的正文黏成一坨，AI 就分不出天了。
 */
export async function docxToText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  const doc = zip.file('word/document.xml')
  if (!doc) throw new Error('这个 Word 文件里找不到正文（word/document.xml）')

  const xml = await doc.async('string')

  const text = xml
    // 段落、换行、表格单元格/行 → 换行，保住结构
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/w:tc>/g, '\n')
    .replace(/<\/w:tr>/g, '\n\n')
    .replace(/<[^>]+>/g, '')
    // XML 实体
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    // 压掉多余空行，但保留段落分隔
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim()

  if (!text) throw new Error('这个 Word 文件读出来是空的')
  return text
}

export async function plainToText(buf: ArrayBuffer): Promise<string> {
  const text = new TextDecoder('utf-8').decode(buf).trim()
  if (!text) throw new Error('这个文件是空的')
  return text
}
