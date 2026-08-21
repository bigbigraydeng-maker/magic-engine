/* LEGAL REVIEW REQUIRED BEFORE MERGE — see docs/marketing/me-entity-alignment-2026-08-18.md §5 + §9.5.
 * Operating entity was updated to Magic Engine AI Technology Limited (New Zealand). This source
 * comment is stripped by the build and never appears in served HTML; the full risk list lives in
 * the audit doc, the PR body, and the PR review checklist. Do not merge without legal counsel. */
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Terms of Service — Magic Engine',
  description: 'Terms and conditions for using Magic Engine.',
}

const CONTACT_EMAIL = 'raydeng@magicengine.com.au'
const EFFECTIVE_DATE = '22 May 2025'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="mb-2 text-3xl font-bold text-gray-900">Terms of Service</h1>
        <p className="mb-10 text-sm text-gray-500">Effective date: {EFFECTIVE_DATE}</p>

        <p className="mb-8 text-gray-700">
          These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Magic
          Engine, operated by Magic Engine AI Technology Limited (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;).
          By using Magic Engine, you agree to be bound by these Terms.
        </p>

        <Section title="1. Eligibility">
          <p className="text-gray-700">
            You must be at least 18 years old and have the authority to enter into a binding
            agreement on behalf of yourself or your organisation. Magic Engine is intended for
            business use only.
          </p>
        </Section>

        <Section title="2. Permitted Use">
          <p className="mb-4 text-gray-700">You agree to use Magic Engine only to:</p>
          <ul className="list-disc pl-6 text-gray-700">
            <li className="mb-2">
              Analyse SEO, advertising, social-media, and GEO performance for websites you own or
              manage with explicit permission from the website owner.
            </li>
            <li className="mb-2">
              Generate and publish marketing content for businesses you represent.
            </li>
            <li className="mb-2">Connect Google accounts you are authorised to connect.</li>
          </ul>
          <p className="mt-4 text-gray-700">
            You must not use Magic Engine to access, analyse, or report on websites or Google
            accounts without authorisation from their owners.
          </p>
        </Section>

        <Section title="3. Google API Services">
          <p className="mb-4 text-gray-700">
            Magic Engine integrates with Google APIs. By connecting a Google account, you
            authorise us to access Google Search Console data on a read-only basis on your behalf.
          </p>
          <p className="text-gray-700">
            Your use of Google services via Magic Engine is also subject to{' '}
            <a
              href="https://policies.google.com/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline"
            >
              Google&rsquo;s Terms of Service
            </a>
            . Magic Engine&rsquo;s use of data obtained from Google APIs complies with the{' '}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-indigo-600 underline"
            >
              Google API Services User Data Policy
            </a>
            .
          </p>
        </Section>

        <Section title="4. Your Content">
          <p className="text-gray-700">
            You retain ownership of all content, data, and materials you upload or create within
            Magic Engine. By using the platform, you grant us a limited licence to process your
            content solely for the purpose of delivering the services described herein. We do not
            claim any ownership over your content and will not use it for any other purpose.
          </p>
        </Section>

        <Section title="5. Intellectual Property">
          <p className="text-gray-700">
            The Magic Engine platform, including its software, design, and AI-generated analysis
            framework, is owned by Magic Engine AI Technology Limited and protected by intellectual property laws. You may
            not copy, modify, distribute, or reverse-engineer any part of the platform.
          </p>
        </Section>

        <Section title="6. Disclaimers">
          <p className="mb-4 text-gray-700">
            Magic Engine is provided &ldquo;as is&rdquo; without warranties of any kind, express
            or implied. We do not warrant that:
          </p>
          <ul className="list-disc pl-6 text-gray-700">
            <li className="mb-2">
              SEO recommendations, keyword data, or advertising insights will achieve specific
              rankings or business results.
            </li>
            <li className="mb-2">
              AI-generated content will be error-free or suitable for publication without review.
            </li>
            <li className="mb-2">The platform will be uninterrupted or free from errors.</li>
          </ul>
          <p className="mt-4 text-gray-700">
            You are responsible for reviewing all AI-generated content before publishing, and for
            ensuring compliance with applicable advertising standards and platform policies.
          </p>
        </Section>

        <Section title="7. Limitation of Liability">
          <p className="text-gray-700">
            To the fullest extent permitted by law, Magic Engine AI Technology Limited shall not be liable for any indirect,
            incidental, special, or consequential damages arising from your use of Magic Engine,
            including but not limited to loss of revenue, loss of data, or loss of business
            opportunity. Our total liability for any claim shall not exceed the fees paid by you
            in the three months preceding the claim.
          </p>
        </Section>

        <Section title="8. Termination">
          <p className="text-gray-700">
            We reserve the right to suspend or terminate your access to Magic Engine at any time
            for breach of these Terms, fraudulent activity, or misuse of connected third-party
            services. You may cancel your account at any time by contacting us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <Section title="9. Governing Law">
          <p className="text-gray-700">
            These Terms are governed by the laws of New South Wales, Australia. Any disputes shall
            be subject to the exclusive jurisdiction of the courts of New South Wales.
          </p>
        </Section>

        <Section title="10. Changes to These Terms">
          <p className="text-gray-700">
            We may update these Terms from time to time. Material changes will be communicated by
            email or platform notice at least 14 days in advance. Continued use after the effective
            date constitutes acceptance.
          </p>
        </Section>

        <Section title="11. Contact">
          <p className="text-gray-700">
            Questions about these Terms? Contact us at{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-indigo-600 underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
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
