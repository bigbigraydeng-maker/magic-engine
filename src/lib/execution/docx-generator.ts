/**
 * 鲁班 Execution Plan — DOCX Report Generator
 *
 * Converts execution items (grouped by phase) into a professional Word document.
 * Sections: cover → per-phase item tables → work logs summary
 */

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
  BorderStyle,
  ShadingType,
  WidthType,
  PageBreak,
} from 'docx'
import type { ExecutionItem, ExecutionLog, ExecutionItemStatus } from '@/types/diagnostic'

const BRAND_COLOR  = '1A5FB4'
const ACCENT_COLOR = '2E4057'
const HEADER_FILL  = 'EEF2FF'
const PAGE_WIDTH   = 9360
const CELL_BORDER  = { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC' } as const
const CELL_BORDERS = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER }

export interface ExecutionItemWithLogs extends ExecutionItem {
  logs: ExecutionLog[]
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function generateExecutionDocx(
  items: ExecutionItemWithLogs[],
  clientName: string,
  reportDate: string = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
): Promise<Buffer> {
  const byPhase = groupByPhase(items)

  const doc = new Document({
    sections: [{
      children: [
        ...coverSection(clientName, items, reportDate),
        ...phaseSection(1, '即时修复', byPhase[1] ?? []),
        ...phaseSection(2, '结构改善', byPhase[2] ?? []),
        ...phaseSection(3, '长期增长', byPhase[3] ?? []),
        ...logsSection(items),
      ],
    }],
  })

  const buf = await Packer.toBuffer(doc)
  return Buffer.from(buf)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByPhase(items: ExecutionItemWithLogs[]): Record<number, ExecutionItemWithLogs[]> {
  return items.reduce<Record<number, ExecutionItemWithLogs[]>>((acc, item) => {
    const p = item.phase
    if (!acc[p]) acc[p] = []
    acc[p].push(item)
    return acc
  }, {})
}

const STATUS_LABELS: Record<ExecutionItemStatus, string> = {
  pending:     '待处理',
  in_progress: '进行中',
  completed:   '已完成',
  skipped:     '已跳过',
}

const DIM_LABELS: Record<string, string> = {
  seo:           'SEO',
  ai_visibility: 'AI 可见度',
  ads:           '广告',
  social:        '社媒',
  reputation:    '口碑',
  competitor:    '竞品',
}

const FIX_LABELS: Record<string, string> = {
  me_auto:     'ME 自动',
  fde_manual:  'FDE 手动',
  third_party: '第三方',
}

// ─── Cover ────────────────────────────────────────────────────────────────────

function coverSection(clientName: string, items: ExecutionItemWithLogs[], date: string): Paragraph[] {
  const total     = items.length
  const completed = items.filter(i => i.status === 'completed').length
  const inProgress = items.filter(i => i.status === 'in_progress').length
  const pending   = items.filter(i => i.status === 'pending').length

  return [
    h1('执行方案'),
    h1(clientName),
    body(date),
    body(' '),
    statLine('执行项总数', String(total)),
    statLine('已完成', String(completed)),
    statLine('进行中', String(inProgress)),
    statLine('待处理', String(pending)),
    pageBreak(),
  ]
}

// ─── Phase section ────────────────────────────────────────────────────────────

function phaseSection(phase: number, phaseName: string, items: ExecutionItemWithLogs[]): Array<Paragraph | Table> {
  if (!items.length) return []

  const rows = items.map(item => [
    item.title,
    DIM_LABELS[item.dimension] ?? item.dimension,
    FIX_LABELS[item.fix_type] ?? item.fix_type,
    STATUS_LABELS[item.status] ?? item.status,
    item.assigned_to ?? '-',
    item.due_date ? item.due_date.slice(0, 10) : '-',
  ])

  const result: Array<Paragraph | Table> = [
    h2(`Phase ${phase} — ${phaseName}`),
    table(['任务', '维度', '执行方式', '状态', '负责人', '截止日期'], rows),
  ]

  // Per-item description block
  for (const item of items) {
    if (item.description) {
      result.push(body(' '))
      result.push(h3(item.title))
      result.push(body(item.description))
    }
  }

  result.push(pageBreak())
  return result
}

// ─── Logs section ─────────────────────────────────────────────────────────────

function logsSection(items: ExecutionItemWithLogs[]): Paragraph[] {
  const itemsWithLogs = items.filter(i => i.logs.length > 0)
  if (!itemsWithLogs.length) return []

  const result: Paragraph[] = [h2('工作日志')]

  for (const item of itemsWithLogs) {
    result.push(h3(item.title))
    for (const log of item.logs) {
      const author = log.author === 'luban' ? '鲁班' : log.author === 'fde' ? 'FDE' : '系统'
      const ts = new Date(log.created_at).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })
      result.push(new Paragraph({
        children: [
          new TextRun({ text: `[${ts}] ${author}：`, bold: true, font: 'Arial', size: 22 }),
          new TextRun({ text: log.content, font: 'Arial', size: 22 }),
        ],
        spacing: { after: 80 },
        indent: { left: 360 },
      }))
    }
    result.push(body(' '))
  }

  return result
}

// ─── Primitive builders ───────────────────────────────────────────────────────

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 40, color: BRAND_COLOR })],
    spacing: { before: 360, after: 240 },
  })
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 32, color: BRAND_COLOR })],
    spacing: { before: 300, after: 180 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BRAND_COLOR, space: 4 } },
  })
}

function h3(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, bold: true, font: 'Arial', size: 26, color: ACCENT_COLOR })],
    spacing: { before: 240, after: 120 },
  })
}

function body(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 24 })],
    spacing: { after: 120 },
  })
}

function statLine(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, font: 'Arial', size: 24 }),
      new TextRun({ text: value, font: 'Arial', size: 24 }),
    ],
    spacing: { after: 80 },
  })
}

function pageBreak(): Paragraph {
  return new Paragraph({ children: [new PageBreak()] })
}

function table(headers: string[], rows: string[][]): Table {
  const colCount = headers.length
  const colWidth = Math.floor(PAGE_WIDTH / colCount)
  const colWidths = Array(colCount).fill(colWidth)

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) =>
      new TableCell({
        borders: CELL_BORDERS,
        width: { size: colWidths[i], type: WidthType.DXA },
        shading: { fill: HEADER_FILL, type: ShadingType.CLEAR },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [new TextRun({ text: h, bold: true, font: 'Arial', size: 22 })],
        })],
      }),
    ),
  })

  const bodyRows = rows.map(row =>
    new TableRow({
      children: Array.from({ length: colCount }, (_, i) =>
        new TableCell({
          borders: CELL_BORDERS,
          width: { size: colWidths[i], type: WidthType.DXA },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: row[i] ?? '', font: 'Arial', size: 22 })],
          })],
        }),
      ),
    }),
  )

  return new Table({
    width: { size: PAGE_WIDTH, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...bodyRows],
  })
}
