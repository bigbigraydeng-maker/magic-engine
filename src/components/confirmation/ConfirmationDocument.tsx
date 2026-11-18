import type { ConfirmationData } from '@/lib/confirmation/types'
import { POWER_BANK_TIP_TITLE } from '@/lib/confirmation/defaults'
import { splitLines } from '@/lib/confirmation/validate'

/** The branded, print-ready confirmation. Browser "Save as PDF" prints exactly this element. */
export default function ConfirmationDocument({ data: d }: { data: ConfirmationData }) {
  const emergency = d.emergencyContacts.filter((c) => c.name.trim())
  const flights = d.flights.filter((f) => f.text.trim())

  return (
    <article id="confirmation-doc" className="mx-auto max-w-[800px] bg-white text-[13px] leading-relaxed text-[#1F2937] shadow-sm print:shadow-none">
      <header className="bg-[#B61E2E] px-8 py-7 text-white">
        <p className="text-[11px] uppercase tracking-[0.25em] opacity-80">China Travel Service · Pre-confirmation</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">Welcome to China! 欢迎到中国！</h1>
        <p className="mt-2 text-lg font-semibold tracking-wide">{d.tourCode || 'CTS——'}</p>
      </header>

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

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 border-b-2 border-[#B61E2E] pb-1 font-serif text-xl font-semibold text-[#B61E2E]">{children}</h2>
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  const b = last ? '' : 'border-b border-[#E5E7EB]'
  return (
    <>
      <dt className={`bg-[#B61E2E]/5 px-3 py-2 font-semibold text-[#1F2937] ${b}`}>{label}</dt>
      <dd className={`px-3 py-2 ${b}`}>{children || <span className="text-[#9CA3AF]">—</span>}</dd>
    </>
  )
}
