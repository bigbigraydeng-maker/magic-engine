import Script from 'next/script'

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim()
const googleAdsId = 'AW-18192230281'

export default function GaScripts() {
  const tagIds = [measurementId, googleAdsId].filter(
    (value): value is string => Boolean(value?.trim()),
  )

  if (tagIds.length === 0) return null

  const primaryTagId = tagIds[0]
  const configCalls = tagIds
    .map((tagId) => `gtag('config', '${tagId}', { send_page_view: true });`)
    .join('\n')

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${primaryTagId}`}
        strategy="afterInteractive"
      />
      <Script id="gtag-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          ${configCalls}
        `}
      </Script>
    </>
  )
}
