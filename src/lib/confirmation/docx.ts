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
import { coverRouteStops, coverTitle, jpegSize } from './cover'

const RED = 'B61E2E'
const NAVY = '1F2937'
const GREY = '6B7280'
const GOLD = 'D6A756'
const LIGHT = 'FBEFF0'
const FONT = { ascii: 'Calibri', eastAsia: 'Microsoft YaHei', hAnsi: 'Calibri' }

const run = (text: string, o: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) =>
  new TextRun({ text, font: FONT, bold: o.bold, color: o.color, size: o.size ?? 21, italics: o.italics })

const para = (text: string, o: { bold?: boolean; color?: string; size?: number; after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({ children: [run(text, o)], spacing: { after: o.after ?? 80 }, alignment: o.align })

const heading = (text: string, pageBreakBefore = false) =>
  new Paragraph({
    children: [run(text, { bold: true, color: RED, size: 28 })],
    pageBreakBefore,
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

const HERO_WIDTH_PX = 640
/** Tallest picture that still leaves room for the title and facts on one A4 page. */
const HERO_MAX_HEIGHT_PX = 420

/** Keep the picture's proportions but never taller than the page allows (portrait pictures are shrunk). */
export function fitHero(size: { width: number; height: number }): { width: number; height: number } {
  const height = Math.min(Math.round((HERO_WIDTH_PX * size.height) / size.width), HERO_MAX_HEIGHT_PX)
  return { width: Math.round((height * size.width) / size.height), height }
}

/** Tailor-made style cover page: picture, title, route, key facts. Ends with the page break the next heading adds. */
function coverPage(d: ConfirmationData, hero: Buffer | null): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({
      children: [run(`PRE-CONFIRMATION  ·  ${d.groundOperator}`, { color: GREY, size: 16 })],
      spacing: { after: 120 },
    }),
  ]
  const size = hero ? jpegSize(hero) : null
  if (hero && size) {
    out.push(
      new Paragraph({
        children: [
          new ImageRun({
            data: hero,
            transformation: fitHero(size),
            type: 'jpg',
          }),
        ],
        spacing: { after: 240 },
      }),
    )
  }
  const meta = (label: string, value: string) =>
    new Paragraph({
      children: [run(`${label.toUpperCase()}   `, { bold: true, color: GOLD, size: 15 }), run(value, { bold: true, size: 22 })],
      spacing: { after: 70 },
    })
  out.push(
    new Paragraph({ children: [run(coverTitle(d), { bold: true, color: NAVY, size: 64 })], spacing: { after: 100 } }),
    para(coverRouteStops(d).join('   ·   ').toUpperCase(), { bold: true, color: RED, size: 20, after: 200 }),
    meta('Tour code', d.tourCode),
    meta('Departure', d.departureDate),
    meta('Travellers', `${d.paxCount} pax`),
  )
  const names = splitLines(d.pickupCardNames)
  if (names.length) out.push(meta('Prepared for', names.join('  /  ')))
  return out
}

/** Build the confirmation as an editable Word file (staff can tweak before sending). */
export async function buildConfirmationDocx(d: ConfirmationData, opts: { hero?: Buffer | null } = {}): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []
  const photoCover = d.cover.style === 'photo'

  if (photoCover) {
    children.push(...coverPage(d, opts.hero ?? null))
  } else {
    children.push(
      new Paragraph({
        children: [run(coverTitle(d), { bold: true, color: RED, size: 40 })],
        spacing: { after: 60 },
      }),
      para(`${d.tourCode}  ·  Pre-confirmation itinerary`, { bold: true, color: NAVY, size: 26, after: 160 }),
    )
  }

  if (photoCover) children.push(heading(`${d.tourCode}  Trip details`, true))
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
                  run(`${d.tourCode}  ·  ${d.groundOperator}  ·  Page `, { color: GREY, size: 16 }),
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
