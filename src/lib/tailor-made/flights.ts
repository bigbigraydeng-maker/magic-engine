import { callClaudeWithDocs } from '@/lib/anthropic/client'
import type { TailorMadeFlight } from './types'

/**
 * 从出票单 PDF 里读出航段。
 *
 * 直接把 PDF 喂给 Claude，不写正则：Amadeus / Sabre / 各航司自出的版式
 * 完全不同（这次的样本是 Amadeus CheckMyTrip），正则只能覆盖当下这一种，
 * 下一份换个系统出的单子就全崩。
 *
 * ⚠️ 这份东西最终会发给旅客本人，他拿着它去值机。所以规则和行程正文一致
 * 且更严：只照抄，不补全。航站楼、舱位、机型缺了就缺着 —— 编一个航站楼
 * 会让人跑错地方。
 */

const SYSTEM_PROMPT = `You read airline ticket / e-itinerary documents and extract the flight segments.

Return ONLY a JSON object, no markdown fence, no commentary:

{
  "bookingRef": "PNR/booking reference, or empty string",
  "flights": [
    {
      "date": "1 Nov",
      "flightNo": "NZ 3889",
      "operatedBy": "Operated by Air China CA784",
      "from": "Auckland",
      "to": "Beijing",
      "departTime": "20:30",
      "arriveTime": "05:00",
      "arriveDayOffset": "+1",
      "duration": "13:30",
      "cabin": "Economy (V)",
      "departTerminal": "I - International",
      "arriveTerminal": "3"
    }
  ]
}

RULES — this document goes to the traveller, who uses it to check in:

- COPY, NEVER COMPLETE. If a terminal, cabin or duration is not printed on the
  document, use an empty string. Inventing a terminal sends someone to the wrong
  building.
- Keep flight numbers exactly as printed, including the space ("NZ 3889").
- operatedBy only when the document says a different carrier operates it.
- arriveDayOffset is "+1" only when the arrival date is later than the departure
  date. Same day → empty string.
- from / to: city name only, no airport code, no parentheses.
- Keep times in the document's own 24h form.
- Segments in departure order.
- Ignore marketing banners, privacy notices, emission figures, agency contact
  blocks — they are not flights.`

export interface FlightParseResult {
  bookingRef: string
  flights: TailorMadeFlight[]
  /** 给顾问看的一句话 */
  note: string
}

function coerce(parsed: unknown): FlightParseResult {
  const o = (parsed ?? {}) as { bookingRef?: unknown; flights?: unknown }
  const raw = Array.isArray(o.flights) ? o.flights : []

  const flights: TailorMadeFlight[] = raw
    .map((f) => f as Record<string, unknown>)
    .filter((f) => typeof f.flightNo === 'string' && (f.flightNo as string).trim())
    .map((f) => ({
      date: String(f.date ?? '').trim(),
      flightNo: String(f.flightNo ?? '').trim(),
      operatedBy: String(f.operatedBy ?? '').trim() || undefined,
      from: String(f.from ?? '').trim(),
      to: String(f.to ?? '').trim(),
      departTime: String(f.departTime ?? '').trim(),
      arriveTime: String(f.arriveTime ?? '').trim(),
      arriveDayOffset: String(f.arriveDayOffset ?? '').trim() || undefined,
      duration: String(f.duration ?? '').trim() || undefined,
      cabin: String(f.cabin ?? '').trim() || undefined,
      departTerminal: String(f.departTerminal ?? '').trim() || undefined,
      arriveTerminal: String(f.arriveTerminal ?? '').trim() || undefined,
    }))

  return {
    bookingRef: String(o.bookingRef ?? '').trim(),
    flights,
    note: flights.length
      ? `读到 ${flights.length} 个航段，请核对航班号与时间后再发给客户。`
      : '没有从这份文件里读到航段 —— 确认上传的是出票单/行程单 PDF。',
  }
}

/** base64 PDF → 航段 */
export async function parseFlightPdf(base64Pdf: string, filename?: string): Promise<FlightParseResult> {
  const res = await callClaudeWithDocs({
    systemPrompt: SYSTEM_PROMPT,
    userMessage: '把这份出票单里的航段提取出来。只输出 JSON。',
    docs: [{ type: 'pdf', content: base64Pdf, filename }],
    maxOutputTokens: 4096,
  })

  let raw = res.text.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()
  if (!raw.startsWith('{')) {
    const a = raw.indexOf('{')
    const b = raw.lastIndexOf('}')
    if (a === -1 || b <= a) throw new Error('模型没有返回 JSON')
    raw = raw.slice(a, b + 1)
  }

  try {
    return coerce(JSON.parse(raw))
  } catch {
    throw new Error('出票单解析结果无法读取，请重试')
  }
}
