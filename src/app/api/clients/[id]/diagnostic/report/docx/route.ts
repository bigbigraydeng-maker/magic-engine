/**
 * GET /api/clients/[id]/diagnostic/report/docx
 *
 * Returns a .docx binary of the diagnostic report for the latest completed run
 * (or ?run_id=xxx).  Converts the clean Markdown artifact (no cite markers)
 * to a Word document using the `docx` npm package.
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S5.3
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  HeadingLevel,
  AlignmentType,
  LevelFormat,
  BorderStyle,
  WidthType,
  ShadingType,
} from 'docx'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { generateReport } from '@/lib/diagnostic/report-generator'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// A4 page with 1-inch margins
const PAGE_WIDTH_DXA = 11906
const MARGIN_DXA = 1440
const CONTENT_WIDTH_DXA = PAGE_WIDTH_DXA - MARGIN_DXA * 2 // 9026

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' }
const CELL_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
}
const HEADER_FILL = 'F0F4F8'

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const url = new URL(req.url)
  let runId = url.searchParams.get('run_id')

  if (!runId) {
    const { data: runs, error: runError } = await supabaseAdmin
      .from('diagnostic_runs')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)

    if (runError) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch diagnostic run' },
        { status: 500 },
      )
    }

    const latest = (runs as unknown[])?.[0] as { id: string } | undefined
    if (!latest) {
      return NextResponse.json(
        { success: false, error: 'No completed diagnostic found' },
        { status: 404 },
      )
    }
    runId = latest.id
  }

  try {
    const artifacts = await generateReport(supabaseAdmin, runId, clientId)
    const buffer = await buildDocx(artifacts.markdown, clientId)
    const filename = `diagnostic-report-${runId.slice(0, 8)}.docx`

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.byteLength),
      },
    })
  } catch (err: unknown) {
    console.error('[diagnostic/report/docx] generation error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'DOCX generation failed',
      },
      { status: 500 },
    )
  }
}

// ---------------------------------------------------------------------------
// Markdown → docx
// ---------------------------------------------------------------------------

type DocxChild = Paragraph | Table

function buildDocx(markdown: string, _clientId: string): Promise<ArrayBuffer> {
  const children = parseMarkdown(markdown)

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: 720, hanging: 360 } },
              },
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 24 },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 40, bold: true, font: 'Arial', color: '1A5FB4' },
          paragraph: {
            spacing: { before: 360, after: 240 },
            outlineLevel: 0,
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: '1A5FB4', space: 4 },
            },
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 32, bold: true, font: 'Arial', color: '1A5FB4' },
          paragraph: {
            spacing: { before: 300, after: 180 },
            outlineLevel: 1,
          },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { size: 26, bold: true, font: 'Arial', color: '2E4057' },
          paragraph: {
            spacing: { before: 240, after: 120 },
            outlineLevel: 2,
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_WIDTH_DXA, height: 16838 },
            margin: {
              top: MARGIN_DXA,
              bottom: MARGIN_DXA,
              left: MARGIN_DXA,
              right: MARGIN_DXA,
            },
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc) as unknown as Promise<ArrayBuffer>
}

// ---------------------------------------------------------------------------
// Markdown parser — handles the subset produced by report-generator
// ---------------------------------------------------------------------------

function parseMarkdown(md: string): DocxChild[] {
  const lines = md.split(/\r?\n/)
  const result: DocxChild[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // blank
    if (line.trim() === '') {
      i++
      continue
    }

    // headings
    const hMatch = /^(#{1,4})\s+(.+)$/.exec(line)
    if (hMatch) {
      const level = hMatch[1].length
      const text = hMatch[2].trim()
      const headingMap: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1,
        2: HeadingLevel.HEADING_2,
        3: HeadingLevel.HEADING_3,
        4: HeadingLevel.HEADING_4,
      }
      result.push(
        new Paragraph({
          heading: headingMap[level] ?? HeadingLevel.HEADING_3,
          children: parseInline(text),
        }),
      )
      i++
      continue
    }

    // GFM table (header | separator | rows)
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]))
        i++
      }
      result.push(buildTable(header, rows))
      continue
    }

    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, '')
        result.push(
          new Paragraph({
            numbering: { reference: 'bullets', level: 0 },
            children: parseInline(itemText),
          }),
        )
        i++
      }
      continue
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '')
        result.push(
          new Paragraph({
            children: [new TextRun(`• ${stripInline(itemText)}`)],
          }),
        )
        i++
      }
      continue
    }

    // paragraph
    const buf: string[] = [line]
    i++
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].includes('|')
    ) {
      buf.push(lines[i])
      i++
    }
    result.push(
      new Paragraph({
        children: parseInline(buf.join(' ')),
        spacing: { after: 120 },
      }),
    )
  }

  return result
}

// ---------------------------------------------------------------------------
// Inline markdown → TextRun[]
// Handles **bold**, *italic*, `code`, plain text
// ---------------------------------------------------------------------------

function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = []
  // Tokenise: **bold**, *italic*, `code`, rest
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let last = 0
  let m: RegExpExecArray | null

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      runs.push(new TextRun({ text: text.slice(last, m.index), font: 'Arial', size: 24 }))
    }
    const token = m[0]
    if (token.startsWith('**')) {
      runs.push(new TextRun({ text: token.slice(2, -2), bold: true, font: 'Arial', size: 24 }))
    } else if (token.startsWith('`')) {
      runs.push(
        new TextRun({
          text: token.slice(1, -1),
          font: 'Courier New',
          size: 22,
          color: '555555',
        }),
      )
    } else {
      runs.push(new TextRun({ text: token.slice(1, -1), italics: true, font: 'Arial', size: 24 }))
    }
    last = m.index + token.length
  }

  if (last < text.length) {
    runs.push(new TextRun({ text: text.slice(last), font: 'Arial', size: 24 }))
  }

  return runs.length > 0 ? runs : [new TextRun({ text, font: 'Arial', size: 24 })]
}

function stripInline(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}

// ---------------------------------------------------------------------------
// Table builder
// ---------------------------------------------------------------------------

function buildTable(header: string[], rows: string[][]): Table {
  const colCount = Math.max(header.length, ...rows.map(r => r.length))
  const colWidth = Math.floor(CONTENT_WIDTH_DXA / colCount)
  const colWidths = Array(colCount).fill(colWidth)

  const headerRow = new TableRow({
    tableHeader: true,
    children: header.map((cell, idx) =>
      new TableCell({
        borders: CELL_BORDERS,
        width: { size: colWidths[idx], type: WidthType.DXA },
        shading: { fill: HEADER_FILL, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: cell, bold: true, font: 'Arial', size: 22 })],
          }),
        ],
      }),
    ),
  })

  const bodyRows = rows.map(
    row =>
      new TableRow({
        children: Array.from({ length: colCount }, (_, idx) => {
          const cellText = row[idx] ?? ''
          return new TableCell({
            borders: CELL_BORDERS,
            width: { size: colWidths[idx], type: WidthType.DXA },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({ children: parseInline(cellText) }),
            ],
          })
        }),
      }),
  )

  return new Table({
    width: { size: CONTENT_WIDTH_DXA, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  })
}

function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map(c => c.trim())
}
