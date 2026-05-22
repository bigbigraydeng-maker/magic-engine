import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Privacy Policy — Magic Engine',
  description: 'How Magic Engine collects, uses, and protects your data.',
}

const CONTACT_EMAIL = 'bigbigraydeng@gmail.com'
const SITE_URL = 'https://crazycontent-27u3.onrender.com'
const EFFECTIVE_DATE = '22 May 2025'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">Privacy Policy</h1>
        <p className="mb-10 text-sm text-gray-500">Effective date: {EFFECTIVE_DATE}</p>

        <p className="mb-8 text-gray-700">
          Magic Engine (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) is an
          AI-powered SEO, social-media, advertising, and GEO execution platform operated by Magic
          Lab. This Privacy Policy explains what information we collect, how we use it, and your
          choices regarding your data when you use our platform at{' '}
          <a href={SITE_URL} className="text-indigo-600 underline">
            {SITE_URL}
          </a>
          .
        </p>

        <Section title="1. Information We Collect">
          <SubSection title="1.1 Account Information">
            <p>
              When you sign up, we collect your name, email address, and password (stored as a
              salted hash). We also record your organisation name and any client workspaces you
              create.
            </p>
          </SubSection>

          <SubSection title="1.2 Google Account Data (OAuth 2.0)">
            <p className="mb-3">
              If you or your clients choose to connect a Google account, we request the following
              OAuth 2.0 scopes via Google&rsquo;s secure authorisation flow:
            </p>
            <ul className="mb-3 list-disc pl-6 text-gray-700">
              <li>
                <strong>email</strong> — to identify which Google account has been connected.
              </li>
              <li>
                <strong>webmasters.readonly</strong> — read-only access to Google Search Console
                data (impressions, clicks, rankings) for websites you manage.
              </li>
            </ul>
            <p>
              We store only the OAuth access token, refresh token, and the connected Google email
              address. We never read, store, or share the contents of your Gmail, Google Drive,
              Google Calendar, or any other Google product beyond the scopes listed above.
            </p>
          </SubSection>

          <SubSection title="1.3 Website & Usage Data">
            <p>
              We collect standard server logs (IP address, browser type, pages visited, timestamps)
              for security monitoring and performance optimisation. This data is retained for 90 days
              and is not linked to individual user profiles.
            </p>
          </SubSection>

          <SubSection title="1.4 Client Data You Upload">
            <p>
              When you use Magic Engine on behalf of your clients, you may upload or input data such
              as website URLs, keywords, advertising performance figures, and content briefs. This
              data is processed to generate reports and recommendations and is not used for any other
              purpose.
            </p>
          </SubSection>
        </Section>

        <Section title="2. How We Use Your Information">
          <ul className="list-disc pl-6 text-gray-700">
            <li className="mb-2">
              <strong>Service delivery</strong> — to generate SEO reports, keyword analysis,
              content recommendations, and advertising insights on your behalf.
            </li>
            <li className="mb-2">
              <strong>Google Search Console data</strong> — used solely to display organic
              performance metrics within your Magic Engine dashboard. We do not sell, share, or use
              this data to train AI models.
            </li>
            <li className="mb-2">
              <strong>Account management</strong> — to authenticate you, send essential service
              emails (password reset, usage alerts), and manage your subscription.
            </li>
            <li className="mb-2">
              <strong>Security & fraud prevention</strong> — to detect and prevent unauthorised
              access to accounts.
            </li>
            <li className="mb-2">
              <strong>Product improvement</strong> — aggregated, de-identified usage patterns help
              us improve platform features. Individual user data is never used for this purpose.
            </li>
          </ul>
          <p className="mt-4 text-sm font-medium text-gray-700">
            Magic Engine&rsquo;s use of information received from Google APIs adheres to the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
        </Section>

        <Section title="3. Data Sharing">
          <p className="mb-4 text-gray-700">
            We do not sell your personal data. We share data only in the following limited
            circumstances:
          </p>
          <ul className="list-disc pl-6 text-gray-700">
            <li className="mb-2">
              <strong>Service providers</strong> — we use Supabase (database), Render (hosting),
              and OpenAI / Anthropic (AI processing). These providers are contractually bound to
              process data only as directed by us.
            </li>
            <li className="mb-2">
              <strong>Legal obligations</strong> — if required by law or court order, we may
              disclose information to appropriate authorities.
            </li>
            <li className="mb-2">
              <strong>Business transfer</strong> — in the event of a merger or acquisition, data
              may transfer to the successor entity under equivalent privacy protections.
            </li>
          </ul>
        </Section>

        <Section title="4. Data Retention">
          <ul className="list-disc pl-6 text-gray-700">
            <li className="mb-2">
              <strong>Account data</strong> — retained for the duration of your account plus 30
              days after deletion to allow recovery.
            </li>
            <li className="mb-2">
              <strong>Google OAuth tokens</strong> — retained while the connection is active.
              Tokens are deleted within 7 days of you revoking access or deleting your account.
            </li>
            <li className="mb-2">
              <strong>Client workspace data</strong> — retained until you delete the workspace.
            </li>
            <li className="mb-2">
              <strong>Server logs</strong> — retained for 90 days, then automatically purged.
            </li>
          </ul>
        </Section>

        <Section title="5. Revoking Google Access">
          <p className="mb-4 text-gray-700">
            You can disconnect your Google account at any time in two ways:
          </p>
          <ol className="list-decimal pl-6 text-gray-700">
            <li className="mb-2">
              <strong>Within Magic Engine</strong> — navigate to the client workspace &rsaquo;
              Connectors &rsaquo; Google Search Console and click &ldquo;Disconnect&rdquo;.
            </li>
            <li className="mb-2">
              <strong>Via Google</strong> — visit{' '}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline"
              >
                myaccount.google.com/permissions
              </a>
              , find &ldquo;Magic Engine&rdquo;, and click &ldquo;Remove access&rdquo;.
            </li>
          </ol>
          <p className="mt-4 text-gray-700">
            Upon disconnection, all stored tokens are deleted within 7 days.
          </p>
        </Section>

        <Section title="6. Your Rights">
          <p className="mb-4 text-gray-700">
            Under the Australian Privacy Act 1988 and the New Zealand Privacy Act 2020, you have
            the right to:
          </p>
          <ul className="list-disc pl-6 text-gray-700">
            <li className="mb-2">Access the personal information we hold about you.</li>
            <li className="mb-2">
              Request correction of inaccurate or incomplete information.
            </li>
            <li className="mb-2">
              Request deletion of your account and associated personal data.
            </li>
            <li className="mb-2">
              Lodge a complaint with the Office of the Australian Information Commissioner (OAIC)
              at{' '}
              <a
                href="https://www.oaic.gov.au"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline"
              >
                oaic.gov.au
              </a>{' '}
              or the New Zealand Privacy Commissioner at{' '}
              <a
                href="https://www.privacy.org.nz"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 underline"
              >
                privacy.org.nz
              </a>
              .
            </li>
          </ul>
          <p className="mt-4 text-gray-700">
            To exercise any of these rights, email us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">
              {CONTACT_EMAIL}
            </a>
            . We will respond within 30 days.
          </p>
        </Section>

        <Section title="7. Security">
          <p className="text-gray-700">
            We protect your data using industry-standard measures: TLS encryption in transit,
            AES-256 encryption at rest, HMAC-signed session tokens, and role-based access controls.
            OAuth tokens are stored encrypted and are never exposed to client-side code. Despite
            these measures, no system is perfectly secure; we encourage you to use a strong,
            unique password and to report any suspected security issues to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <Section title="8. Cookies">
          <p className="text-gray-700">
            We use a single session cookie to keep you signed in. We do not use advertising
            cookies, third-party tracking pixels, or fingerprinting technologies. You can disable
            cookies in your browser settings, but this will prevent you from staying signed in.
          </p>
        </Section>

        <Section title="9. Children's Privacy">
          <p className="text-gray-700">
            Magic Engine is intended for business use and is not directed at persons under the age
            of 18. We do not knowingly collect personal information from minors.
          </p>
        </Section>

        <Section title="10. Changes to This Policy">
          <p className="text-gray-700">
            We may update this Privacy Policy from time to time. Material changes will be notified
            by email or by a prominent banner on the platform at least 14 days before taking effect.
            Continued use of Magic Engine after the effective date constitutes acceptance of the
            updated policy.
          </p>
        </Section>

        <Section title="11. Contact Us">
          <p className="text-gray-700">
            For privacy-related questions, data access requests, or to report a concern, contact us
            at:
          </p>
          <address className="mt-4 not-italic text-gray-700">
            <strong>Magic Lab</strong>
            <br />
            Email:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">
              {CONTACT_EMAIL}
            </a>
          </address>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-xl font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-2 font-semibold text-gray-800">{title}</h3>
      <div className="text-gray-700">{children}</div>
    </div>
  )
}
