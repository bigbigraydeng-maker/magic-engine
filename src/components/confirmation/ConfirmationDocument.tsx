import type { ConfirmationData } from '@/lib/confirmation/types'
import { POWER_BANK_TIP_TITLE } from '@/lib/confirmation/defaults'
import { splitLines } from '@/lib/confirmation/validate'
import { coverRouteStops, coverTitle } from '@/lib/confirmation/cover'

/** The branded, print-ready confirmation. Browser "Save as PDF" prints exactly this element. */
export default function ConfirmationDocument({ data: d, heroSrc }: { data: ConfirmationData; heroSrc?: string | null }) {
  const emergency = d.emergencyContacts.filter((c) => c.name.trim())
  const flights = d.flights.filter((f) => f.text.trim())

  return (
    <article id="confirmation-doc" className="mx-auto max-w-[800px] bg-white text-[13px] leading-relaxed text-[#1F2937] shadow-sm print:shadow-none">
      <div className="flex h-[6px]" aria-hidden>
        <i className="block w-[64%] bg-[#B61E2E]" />
        <i className="block w-[36%] bg-[#D6A756]" />
      </div>

      {d.cover.style === 'photo' ? (
        <section className="break-after-page">
          <div
            className="relative h-[430px] bg-[#2b2a28] bg-cover bg-center"
            style={heroSrc ? { backgroundImage: `url("${heroSrc}")` } : undefined}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-[#23201C]/40 via-transparent via-30% to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[#FBF7F0]" />
            <p className="absolute left-8 top-8 text-[11px] uppercase tracking-[0.24em] text-white [text-shadow:0_1px_6px_rgba(0,0,0,.45)]">
              Pre-confirmation · {d.groundOperator || 'Ground operator'}
            </p>
          </div>
          <div className="bg-[#FBF7F0] px-8 pb-10 pt-4">
            <h1 className="font-serif text-[38px] font-semibold leading-[1.1] tracking-tight text-[#23201C]">{coverTitle(d)}</h1>
            <p className="mt-3 text-[13px] font-semibold uppercase tracking-[0.15em] text-[#B61E2E]">{coverRouteStops(d).join('  ·  ')}</p>
            <div className="my-5 h-px bg-[#E4DCD0]" />
            <div className="flex flex-wrap gap-x-12 gap-y-4 text-[13px]">
              <Meta label="Tour code">{d.tourCode || '——'}</Meta>
              <Meta label="Departure">{d.departureDate}</Meta>
              <Meta label="Travellers">{d.paxCount} pax</Meta>
            </div>
            {splitLines(d.pickupCardNames).length > 0 && (
              <div className="mt-8">
                <Meta label="Prepared for">
                  {splitLines(d.pickupCardNames).map((n, i) => (
                    <div key={i}>{n}</div>
                  ))}
                </Meta>
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="bg-[#B61E2E] px-8 py-7 text-white">
          <p className="text-[11px] uppercase tracking-[0.25em] opacity-80">{d.groundOperator || 'Ground operator'} · Pre-confirmation</p>
          <h1 className="mt-1 font-serif text-3xl font-semibold">{coverTitle(d)}</h1>
          <p className="mt-2 text-lg font-semibold tracking-wide">{d.tourCode || '——'}</p>
        </div>
      )}

      <div className="px-8 py-6">
        <dl className="grid grid-cols-[170px_1fr] overflow-hidden rounded-lg border border-[#E5E7EB] text-[13px]">
          <Row label="Your Ground Operator">
            {d.groundOperator} <span className="text-[#6B7280]">· Tel: {d.operatorTel}</span>
          </Row>
          <Row label="Tour Code / Departure">
            <strong>{d.tourCode}</strong> <span className="text-[#6B7280]">· Dept: {d.departureDate}</span>
          </Row>
          <Row label="Emergency Contact">
            {emergency.map((c, i) => (
              <div key={i}>
                {c.name} <span className="text-[#6B7280]">MP: {c.mobile}</span>
              </div>
            ))}
          </Row>
          <Row label="Number of tourists">{d.paxCount} pax</Row>
          <Row label="Rooms">{d.rooms}</Row>
          <Row label="Flight information (self-booking)">
            {flights.map((f, i) => (
              <div key={i} className="font-mono text-[12px]">{f.text}</div>
            ))}
          </Row>
          <Row label="Pick-up card">
            {splitLines(d.pickupCardNames).map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </Row>
          <Row label="Guide" last>{d.guideNote}</Row>
        </dl>

        <h2 className="mb-3 mt-8 border-b-2 border-[#B61E2E] pb-1 font-serif text-xl font-semibold text-[#B61E2E]">
          {d.tourCode} · Itinerary
        </h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-[#B61E2E] text-white">
              {['Day', 'Route', 'Highlights', 'Overnight'].map((h) => (
                <th key={h} className="border border-[#B61E2E] px-3 py-2 text-[12px] font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {d.days.map((day, i) => (
              <tr key={i} className="break-inside-avoid align-top">
                <td className="whitespace-nowrap border border-[#E5E7EB] px-3 py-2 font-semibold text-[#B61E2E]">{day.date}</td>
                <td className="border border-[#E5E7EB] px-3 py-2 font-semibold">{day.route}</td>
                <td className="border border-[#E5E7EB] px-3 py-2">
                  {splitLines(day.highlights).map((l, j) => (
                    <p key={j} className="mb-1 last:mb-0">{l}</p>
                  ))}
                </td>
                <td className="border border-[#E5E7EB] px-3 py-2">{day.overnight}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {d.itineraryNote.trim() && (
          <p className="mt-3 rounded-md border-l-4 border-[#B61E2E] bg-[#B61E2E]/5 px-3 py-2 text-[12px]">
            <strong className="text-[#B61E2E]">Note: </strong>
            {d.itineraryNote}
          </p>
        )}

        {d.hotels.length > 0 && (
          <>
            <Heading>Accommodation</Heading>
            <div className="space-y-3">
              {d.hotels.map((h, i) => (
                <div key={i} className="break-inside-avoid rounded-lg border border-[#E5E7EB] px-4 py-3">
                  <p className="font-semibold">
                    {h.city} – {h.name} <span className="text-[#B61E2E]">{'★'.repeat(Math.max(0, Math.min(5, h.stars)))}</span>
                  </p>
                  <p>Address: {h.address}</p>
                  <p>Phone: {h.phone}</p>
                  {splitLines(h.chinese).map((l, j) => (
                    <p key={j} className="text-[#4B5563]">{l}</p>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="grid gap-6 sm:grid-cols-2 print:grid-cols-2">
          <div className="break-inside-avoid">
            <Heading>Inclusions</Heading>
            <ul className="list-disc space-y-1 pl-5">
              {d.inclusions.filter((s) => s.trim()).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
          <div className="break-inside-avoid">
            <Heading>Exclusions</Heading>
            <ul className="list-disc space-y-1 pl-5">
              {d.exclusions.filter((s) => s.trim()).map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        </div>

        <Heading>Travel Tips to China</Heading>
        <div className="space-y-4">
          {d.tips.map((t, i) => (
            <section key={i} className="break-inside-avoid">
              <h3 className="font-semibold text-[#1F2937]">{i + 1}. {t.title}</h3>
              {splitLines(t.body).map((l, j) => (
                <p key={j} className="mt-1">{l}</p>
              ))}
              {t.title === POWER_BANK_TIP_TITLE && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src="/confirmation/powerbank-3c.png" alt="3C mark on a power bank" className="mt-2 w-60 rounded-md border border-[#E5E7EB]" />
              )}
            </section>
          ))}
        </div>

        <p className="mt-8 text-center font-serif text-xl font-semibold text-[#B61E2E]">祝您旅途愉快！ Have a nice trip!</p>
      </div>
    </article>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#D6A756]">{label}</p>
      <div className="font-medium text-[#23201C]">{children}</div>
    </div>
  )
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 border-b-2 border-[#B61E2E] pb-1 font-serif text-xl font-semibold text-[#B61E2E]">{children}</h2>
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  const b = last ? '' : 'border-b border-[#E5E7EB]'
  return (
    <>
      <dt className={`bg-[#FBF7F0] px-3 py-2 font-semibold text-[#1F2937] ${b}`}>{label}</dt>
      <dd className={`px-3 py-2 ${b}`}>{children || <span className="text-[#9CA3AF]">—</span>}</dd>
    </>
  )
}
