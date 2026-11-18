import fs from 'fs'
import path from 'path'
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'
import type { ConfirmationData } from './types'
import { POWER_BANK_TIP_TITLE } from './defaults'
import { splitLines } from './validate'

const RED = 'B61E2E'
const NAVY = '1F2937'
const GREY = '6B7280'
const LIGHT = 'FBEFF0'
const FONT = { ascii: 'Calibri', eastAsia: 'Microsoft YaHei', hAnsi: 'Calibri' }

const run = (text: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, bold: o.bold, color: o.color, size: o.size ?? 21, italics: o.italics })

const para = (text: string, o: { bold?: boolean; color?: string; size?: number; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({ children: [run(text, o)], spacing: { after: o.after ?? 80 }, alignment: o.align })

const heading = (text: string) =>
  new Paragraph({
    children: [run(text, { bold: true, color: RED, size: 28 })],
    keepNext: true,
    spacing: { before: 280, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: RED, space: 4 } },
  })

const bullets = (items: string[]) =>
  items.filter((s) => s.trim()).map(
    (s) => new Paragraph({ children: [run(s)], bullet: { level: 0 }, spacing: { after: 50 } }),
  )

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const LINE = { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' }

function cell(children: Paragraph[], o: { width: number; fill?: string } ) {
  return new TableCell({
    children,
    width: { size: o.width, type: WidthType.DXA },
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    margins: { top: 80, bottom: 80, left: 110, right: 110 },
    borders: { top: LINE, bottom: LINE, left: LINE, right: LINE },
  })
}

function infoRow(label: string, value: string[]): TableRow {
  return new TableRow({
    children: [
      cell([para(label, { bold: true, color: NAVY, after: 0 })], { width: 2700, fill: LIGHT }),
      cell(value.length ? value.map((v) => para(v, { after: 20 })) : [para('—', { color: GREY, after: 0 })], { width: 7200 }),
    ],
  })
}

function itineraryTable(d: ConfirmationData): Table {
  const head = ['Day', 'Route', 'Highlights', 'Overnight']
  const widths = [1000, 2000, 5400, 1500]
  const headerRow = new TableRow({
    tableHeader: true,
    children: head.map((h, i) => cell([para(h, { bold: true, color: 'FFFFFF', after: 0 })], { width: widths[i], fill: RED })),
  })
  const rows = d.days.map(
    (day) =>
      new TableRow({
        cantSplit: true,
        children: [
          cell([para(day.date, { bold: true, color: RED, after: 0 })], { width: widths[0] }),
          cell([para(day.route, { bold: true, after: 0 })], { width: widths[1] }),
          cell(splitLines(day.highlights).map((l) => para(l, { after: 40 })), { width: widths[2] }),
          cell([para(day.overnight, { after: 0 })], { width: widths[3] }),
        ],
      }),
  )
  return new Table({ width: { size: 9900, type: WidthType.DXA }, columnWidths: widths, rows: [headerRow, ...rows] })
}

function powerBankImage(): Paragraph | null {
  try {
    const file = path.join(process.cwd(), 'public', 'confirmation', 'powerbank-3c.png')
    const data = fs.readFileSync(file)
    return new Paragraph({
      children: [new ImageRun({ data, transformation: { width: 260, height: 195 }, type: 'png' })],
      spacing: { before: 60, after: 120 },
    })
  } catch {
    return null
  }
}

/** Build the confirmation as an editable Word file (staff can tweak before sending). */
export async function buildConfirmationDocx(d: ConfirmationData): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []

  children.push(
    new Paragraph({
      children: [run('Welcome to China! 欢迎到中国！', { bold: true, color: RED, size: 40 })],
      spacing: { after: 60 },
    }),
    para(`${d.tourCode}  ·  Pre-confirmation itinerary`, { bold: true, color: NAVY, size: 26, after: 160 }),
  )

  const emergency = d.emergencyContacts.filter((c) => c.name.trim()).map((c) => `${c.name}   MP: ${c.mobile}`)
  children.push(
    new Table({
      width: { size: 9900, type: WidthType.DXA },
      columnWidths: [2700, 7200],
      rows: [
        infoRow('Your Ground Operator', [`${d.groundOperator}   Tel: ${d.operatorTel}`]),
        infoRow('Your Tour Code', [`${d.tourCode}      Dept: ${d.departureDate}`]),
        infoRow('Emergency Contact', emergency),
        infoRow('Number of tourists', [`${d.paxCount} pax`]),
        infoRow('Rooms', [d.rooms]),
        infoRow('Flight information (self-booking)', d.flights.map((f) => f.text).filter((t) => t.trim())),
        infoRow('Pick-up card', splitLines(d.pickupCardNames)),
        infoRow('Guide', [d.guideNote]),
      ],
    }),
    heading(`${d.tourCode}  Pre-confirmation itinerary`),
    itineraryTable(d),
  )
  if (d.itineraryNote.trim()) {
    children.push(new Paragraph({ children: [run('Note: ', { bold: true, color: RED }), run(d.itineraryNote)], spacing: { before: 120, after: 80 } }))
  }

  if (d.hotels.length) {
    children.push(heading('Accommodation'))
    for (const h of d.hotels) {
      children.push(
        para(`${h.city} – ${h.name} ${h.stars}-star`, { bold: true, after: 20 }),
        para(`Address: ${h.address}`, { after: 20 }),
        para(`Phone: ${h.phone}`, { after: 40 }),
        ...splitLines(h.chinese).map((l) => para(l, { after: 20, color: GREY })),
      )
    }
  }

  children.push(heading('Inclusions'), ...bullets(d.inclusions), heading('Exclusions'), ...bullets(d.exclusions))

  children.push(heading('Travel Tips to China'))
  d.tips.forEach((t, i) => {
    children.push(para(`${i + 1}. ${t.title}`, { bold: true, color: NAVY, after: 40 }))
    splitLines(t.body).forEach((l) => children.push(para(l, { after: 40 })))
    if (t.title === POWER_BANK_TIP_TITLE) {
      const img = powerBankImage()
      if (img) children.push(img)
    }
  })

  children.push(new Paragraph({ children: [run('祝您旅途愉快！ Have a nice trip!', { bold: true, color: RED, size: 28 })], alignment: AlignmentType.CENTER, spacing: { before: 360 } }))

  const doc = new Document({
    creator: 'CTS Tours',
    title: `${d.tourCode} confirmation`,
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  run(`${d.tourCode}  ·  China Travel Service  ·  Page `, { color: GREY, size: 16 }),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT, color: GREY, size: 16 }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
