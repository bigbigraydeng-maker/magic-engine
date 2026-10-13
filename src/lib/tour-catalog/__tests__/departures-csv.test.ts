import { describe, it, expect } from 'vitest'
import {
  parseCsv,
  parseDeparturesCsv,
  STATUS_LABELS,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
} from '../departures-csv'

describe('parseCsv', () => {
  it('splits simple comma-separated records', () => {
    const result = parseCsv(['a,b,c', 'd,e,f'].join('\n'))
    expect(result).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ])
  })

  it('handles quoted fields containing commas', () => {
    const result = parseCsv('a,"b,c",d')
    expect(result).toEqual([['a', 'b,c', 'd']])
  })

  it('handles escaped quotes inside quoted fields', () => {
    const result = parseCsv('a,"he said ""hi""",b')
    expect(result).toEqual([['a', 'he said "hi"', 'b']])
  })

  it('handles quoted fields containing newlines', () => {
    const result = parseCsv('a,"line1\nline2",b')
    expect(result).toEqual([['a', 'line1\nline2', 'b']])
  })

  it('accepts CRLF line endings', () => {
    const result = parseCsv('a,b\r\nc,d')
    expect(result).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })

  it('strips a leading UTF-8 BOM', () => {
    const result = parseCsv('\uFEFFa,b')
    expect(result).toEqual([['a', 'b']])
  })

  it('does not create an extra record for a trailing newline', () => {
    const result = parseCsv('a,b\n')
    expect(result).toEqual([['a', 'b']])
  })

  it('does not create an extra record for a trailing CRLF', () => {
    const result = parseCsv('a,b\r\n')
    expect(result).toEqual([['a', 'b']])
  })
})

describe('parseDeparturesCsv header mapping', () => {
  it('maps Chinese headers', () => {
    const csv = [
      '行程名称,出团日期,返程日期,状态,航空公司,人数,去程航段,返程航段',
      'China Legacy,2027-05-28,2027-06-05,open,东航,20,奥克兰-上海+1,上海-奥克兰',
    ].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBeNull()
    expect(result.rejected).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({
      line: 2,
      tourName: 'China Legacy',
      departOn: '2027-05-28',
      returnOn: '2027-06-05',
      status: 'open',
      internal: {
        airline: '东航',
        capacity: 20,
        outboundRoute: '奥克兰-上海+1',
        inboundRoute: '上海-奥克兰',
      },
    })
  })

  it('maps English headers', () => {
    const csv = [
      'tour,depart_on,return_on,status,airline,capacity,outbound_route,inbound_route',
      'China Legacy,2027-05-28,2027-06-05,limited,China Eastern,20,AKL-PVG+1,PVG-AKL',
    ].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBeNull()
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].status).toBe('limited')
    expect(result.rows[0].internal).toEqual({
      airline: 'China Eastern',
      capacity: 20,
      outboundRoute: 'AKL-PVG+1',
      inboundRoute: 'PVG-AKL',
    })
  })

  it('maps headers case-insensitively and trims them', () => {
    const csv = [' Tour , DEPART_ON , Return_On ', 'China Legacy,2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBeNull()
    expect(result.rows).toHaveLength(1)
  })

  it('treats the status column as optional', () => {
    const csv = ['tour,depart_on,return_on', 'China Legacy,2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBeNull()
    expect(result.rows[0].status).toBeNull()
  })

  it('returns fatal missing_required_columns when tourName is absent', () => {
    const csv = ['depart_on,return_on', '2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBe('missing_required_columns')
    expect(result.rows).toEqual([])
  })

  it('returns fatal missing_required_columns when departOn is absent', () => {
    const csv = ['tour,return_on', 'China Legacy,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBe('missing_required_columns')
    expect(result.rows).toEqual([])
  })

  it('returns fatal missing_required_columns when returnOn is absent', () => {
    const csv = ['tour,depart_on', 'China Legacy,2027-05-28'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBe('missing_required_columns')
    expect(result.rows).toEqual([])
  })
})

describe('parseDeparturesCsv row handling', () => {
  const header = 'tour,depart_on,return_on,status,airline,capacity,outbound_route,inbound_route'

  it('skips fully blank records silently', () => {
    const csv = [header, ',,,', 'China Legacy,2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBeNull()
    expect(result.rows).toHaveLength(1)
    expect(result.rejected).toEqual([])
  })

  it('reports line numbers with header as line 1 and first data row as line 2', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rows[0].line).toBe(2)
  })

  it('keeps correct line numbers when blank rows exist between data rows', () => {
    const csv = [
      header,
      'China Legacy,2027-05-28,2027-06-05',
      ',,,',
      'Japan Discovery,2027-07-01,2027-07-10',
    ].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].line).toBe(2)
    expect(result.rows[1].line).toBe(4)
  })

  it('rejects a row with an empty tour name', () => {
    const csv = [header, ',2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([{ line: 2, reason: 'missing_tour_name' }])
  })

  it('rejects a row with an invalid depart date', () => {
    const csv = [header, 'China Legacy,2027-13-01,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'invalid_depart_date', detail: '2027-13-01' },
    ])
  })

  it('rejects a row with a missing return date', () => {
    const csv = [header, 'China Legacy,2027-05-28,'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([{ line: 2, reason: 'missing_return_date' }])
  })

  it('rejects a row with an invalid return date', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-02-30'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'invalid_return_date', detail: '2027-02-30' },
    ])
  })

  it('rejects a row where return is before depart', () => {
    const csv = [header, 'China Legacy,2027-06-05,2027-05-28'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([{ line: 2, reason: 'return_before_depart' }])
  })

  it('accepts a row where return equals depart', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-05-28'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([])
    expect(result.rows).toHaveLength(1)
  })

  it('rejects a row with an invalid status', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,pending'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'invalid_status', detail: 'pending' },
    ])
  })

  it('rejects an unknown Chinese status word', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,满员了'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'invalid_status', detail: '满员了' },
    ])
  })

  it('accepts status case-insensitively and stores it lowercase', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,SOLD_OUT'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([])
    expect(result.rows[0].status).toBe('sold_out')
  })

  it('maps each Chinese status word to its status', () => {
    const cases: [string, string][] = [
      ['可订', 'open'],
      ['开放', 'open'],
      ['少量余位', 'limited'],
      ['余位不多', 'limited'],
      ['满团', 'sold_out'],
      ['已满', 'sold_out'],
      ['已售罄', 'sold_out'],
      ['售罄', 'sold_out'],
      ['关闭', 'closed'],
      ['已关闭', 'closed'],
      ['取消', 'cancelled'],
      ['已取消', 'cancelled'],
    ]
    for (const [word, status] of cases) {
      const csv = [header, `China Legacy,2027-05-28,2027-06-05,${word}`].join('\n')
      const result = parseDeparturesCsv(csv)
      expect(result.rejected).toEqual([])
      expect(result.rows[0].status).toBe(status)
    }
  })

  it('rejects formula injection in the tour name', () => {
    const csv = [header, '=cmd|calc,2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'formula_injection', detail: 'tourName' },
    ])
  })

  it('rejects formula injection in the airline cell', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,open,+EVIL'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'formula_injection', detail: 'airline' },
    ])
  })

  it('rejects formula injection in the outbound route cell', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,open,China Eastern,20,@route'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'formula_injection', detail: 'outboundRoute' },
    ])
  })

  it('rejects formula injection in the inbound route cell', () => {
    const csv = [
      header,
      'China Legacy,2027-05-28,2027-06-05,open,China Eastern,20,AKL-PVG,\tPVG-AKL',
    ].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'formula_injection', detail: 'inboundRoute' },
    ])
  })

  it('accepts a leading hyphen in the tour name', () => {
    const csv = [header, '-China Legacy,2027-05-28,2027-06-05'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].tourName).toBe('-China Legacy')
  })

  it('rejects a non-positive-integer capacity', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,open,China Eastern,abc'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'invalid_capacity', detail: 'abc' },
    ])
  })

  it('rejects a zero capacity', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,open,China Eastern,0'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rejected).toEqual([
      { line: 2, reason: 'invalid_capacity', detail: '0' },
    ])
  })

  it('omits empty internal keys and includes capacity as a number', () => {
    const csv = [header, 'China Legacy,2027-05-28,2027-06-05,open,,20,,'].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.rows[0].internal).toEqual({ capacity: 20 })
  })

  it('rejects the real-looking row with an empty return date', () => {
    const csv = [
      '行程名称,出团日期,返程日期,航空公司,人数,去程航段,返程航段',
      'China Legacy,2027-05-28,,东航,20,奥克兰-上海+1,540+T',
    ].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBeNull()
    expect(result.rows).toEqual([])
    expect(result.rejected).toEqual([{ line: 2, reason: 'missing_return_date' }])
  })
})

describe('STATUS_LABELS', () => {
  it('provides a Chinese label for every status', () => {
    expect(STATUS_LABELS).toEqual({
      open: '可订',
      limited: '少量余位',
      sold_out: '已满团',
      closed: '已关闭',
      cancelled: '已取消',
    })
  })
})

describe('parseDeparturesCsv limits', () => {
  it('returns fatal file_too_large when the file exceeds MAX_CSV_BYTES', () => {
    const header = 'tour,depart_on,return_on'
    const padding = 'x'.repeat(MAX_CSV_BYTES)
    const csv = [header, padding].join('\n')
    expect(Buffer.byteLength(csv, 'utf8')).toBeGreaterThan(MAX_CSV_BYTES)
    const result = parseDeparturesCsv(csv)
    expect(result).toEqual({ rows: [], rejected: [], fatal: 'file_too_large' })
  })

  it('returns fatal too_many_rows when data records exceed MAX_CSV_ROWS', () => {
    const header = 'tour,depart_on,return_on'
    const dataRows: string[] = []
    for (let i = 0; i < MAX_CSV_ROWS + 1; i += 1) {
      dataRows.push('China Legacy,2027-05-28,2027-06-05')
    }
    const csv = [header, ...dataRows].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result).toEqual({ rows: [], rejected: [], fatal: 'too_many_rows' })
  })

  it('accepts exactly MAX_CSV_ROWS data records', () => {
    const header = 'tour,depart_on,return_on'
    const dataRows: string[] = []
    for (let i = 0; i < MAX_CSV_ROWS; i += 1) {
      dataRows.push('China Legacy,2027-05-28,2027-06-05')
    }
    const csv = [header, ...dataRows].join('\n')
    const result = parseDeparturesCsv(csv)
    expect(result.fatal).toBeNull()
    expect(result.rows).toHaveLength(MAX_CSV_ROWS)
  })
})
