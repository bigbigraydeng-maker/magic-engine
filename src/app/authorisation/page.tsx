import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Account Access & Authorisation',
  description:
    'How to give Magic Engine access to your Google, Facebook, and website accounts so we can run and report on your marketing. One-time setup, about 15 minutes, revocable at any time.',
}

/** The account that receives platform invitations. Must be usable as a Google account. */
const INVITE_EMAIL = 'hello@magicengine.cloud'
/** Magic Engine's Meta Business Portfolio ID — verified against Meta Business Settings. */
const META_BUSINESS_ID = '1265811139097132'
const CONTACT_EMAIL = 'hello@magicengine.cloud'
/** Where the customer-facing OAuth link actually lives (NEXT_PUBLIC_APP_URL). */
const CONNECT_HOST = 'app.magicengine.com.au'

const OVERVIEW = [
  {
    platform: 'Google Search Console + Google Analytics',
    what: 'Read your search and traffic data, and ask Google to re-crawl pages we update',
    how: 'One click — we send you a personal link',
    time: '1 min',
  },
  {
    platform: 'Google Business Profile',
    what: 'Handle reviews, keep your listing accurate, publish updates',
    how: 'Add us as a Manager',
    time: '3 min',
  },
  {
    platform: 'Facebook & Instagram',
    what: 'Run and report on ads from your Page',
    how: 'Add us as a Partner in Meta Business Settings',
    time: '5 min',
  },
  {
    platform: 'Google Ads',
    what: 'Manage campaigns, pause waste, adjust bids',
    how: 'Invite us with Standard access',
    time: '2 min',
  },
  {
    platform: 'Your website backend',
    what: 'Publish content and fix technical SEO issues',
    how: 'Invite us as an Editor',
    time: '2 min',
  },
]

const REVOKE_ROUTES = [
  {
    label: 'Search Console & Analytics',
    path: 'myaccount.google.com/connections → Magic Engine → Remove access',
  },
  {
    label: 'Google Business Profile',
    path: 'Your profile → Business Profile settings → People and access → our name → Remove',
  },
  {
    label: 'Facebook & Instagram',
    path: 'business.facebook.com → Business Settings → Partners → Magic Engine → Remove',
  },
  {
    label: 'Google Ads',
    path: 'Admin → Access and security → Users → the ⋮ beside our name → Remove access',
  },
  { label: 'Your website', path: 'Users → our account → Delete' },
]

const GBP_STEPS = [
  'Sign in with the Google account that owns your listing, then search your business name on Google. On a computer your profile panel appears on the right; on a phone it appears at the top of the results, with buttons like Edit profile and Promote. If you do not see those buttons, you are signed in with a different account — that is the most common reason this step fails.',
  'Open the three-dot More menu and choose Business Profile settings. (business.google.com takes you to the same place.)',
  'Open People and access, then click the Add icon.',
  `Enter ${INVITE_EMAIL} and choose the role Manager — not Owner.`,
  'Click Invite. We accept from our side and confirm back to you.',
]

const META_ROUTES = [
  {
    label: 'I already manage ads in Business Suite',
    body: 'Carry on to step 2 below.',
  },
  {
    label: 'I have only ever run my Page from my own Facebook account',
    body: 'Then there is no Business Portfolio yet, and nothing to share with us. That is completely normal for a small business. Tell us and we will either set one up with you over a screen-share, or start with Option B instead. Please do not create one on your own — a duplicate portfolio is harder to untangle than it is to avoid.',
  },
  {
    label: 'Someone else set this up for me — an agency, a family member, a past web person',
    body: 'They will need to do this part, or hand full control back to you first. Send us their name and we will draft the email for you.',
  },
]

const META_STEPS = [
  {
    title: 'Open Meta Business Suite',
    body: 'Go to business.facebook.com and sign in with the account that has full control of the Page and ad account.',
  },
  {
    title: 'Open Business Settings',
    body: 'From the left menu, open Settings, then Business Settings. Meta calls this area a Business Portfolio or Business Manager depending on how your account was set up.',
  },
  {
    title: 'Add Magic Engine as a Partner',
    body: 'In the sidebar under Users, open Partners. Click Add, then choose "Give a partner access to your assets".',
  },
  {
    title: 'Enter our Business ID',
    body: `Paste the ID shown below. Meta will display a business name once you do — it should read Magic Engine. If it shows any other name, stop and contact us.`,
  },
  {
    title: 'Choose what we can access',
    body: 'Select your ad account and enable managing campaigns. Then select your Facebook Page and enable the permissions for ads and insights, so campaigns can run under your Page identity.',
  },
  {
    title: 'Save, and tell us',
    body: 'Review what you selected and save. Let us know once it is done — we will confirm the connection is live, usually within one business day.',
  },
]

const GUARANTEES = [
  'You stay the owner of every account. None of the access levels on this page can transfer ownership away from you, or remove you from your own account. The one exception we flag openly is WordPress Administrator — see that section below.',
  'You can revoke our access at any time, without asking us first and without explaining why. The routes are listed at the top of this page.',
  'We never receive your passwords. Every method here works through the platform’s own invitation or consent flow.',
  'We only use the access you grant to run and report on your marketing — never for another client, and never sold or passed on.',
  'When we stop working together, ask us to remove our access and we will. You can also remove it yourself in a couple of minutes using the same routes.',
]

export default function AuthorisationPage() {
  return (
    <div className="min-h-screen bg-[#f6f7f2] text-slate-950">
      <SiteHeader />

      <main className="mx-auto max-w-4xl px-6 py-16">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
          Account access
        </p>
        <h1 className="mt-4 text-4xl font-black leading-tight sm:text-5xl">
          Giving Magic Engine access to your accounts
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
          To run your marketing we need access to the accounts that hold your data and
          your audience — your Google properties, your Facebook Page, and your website.
          This is a one-time setup of roughly 15 minutes. You keep ownership of
          everything, and you can revoke any of it at any time.
        </p>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          You do not have to do all of it at once. Start with whatever is relevant to the
          work we have agreed on — each section below stands on its own.
        </p>

        <RevokeFirst />
        <OverviewTable />
        <GoogleDataSection />
        <BusinessProfileSection />
        <MetaSection />
        <GoogleAdsSection />
        <WebsiteSection />
        <GuaranteesSection />
        <ContactSection />
      </main>

      <SiteFooter />
    </div>
  )
}

function SiteHeader() {
  return (
    <header className="flex items-center justify-between bg-slate-950 px-5 py-5 sm:px-8">
      <Link href="/" className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-sm font-black text-slate-950">
          M
        </div>
        <span className="text-sm font-bold text-white">Magic Engine</span>
      </Link>
      <nav className="hidden items-center gap-6 text-sm font-semibold text-slate-300 md:flex">
        <Link href="/#product" className="hover:text-white">
          Product
        </Link>
        <Link href="/about" className="hover:text-white">
          About
        </Link>
        <Link href="/portal/login" className="hover:text-white">
          Portal
        </Link>
      </nav>
      <Link
        href="/contact"
        className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-slate-950"
      >
        Contact us
      </Link>
    </header>
  )
}

function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white px-5 py-8 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-4 text-sm text-slate-500 sm:flex-row">
        <p>© {new Date().getFullYear()} Magic Engine AI Technology Limited. All rights reserved.</p>
        <nav className="flex gap-6">
          <Link href="/about" className="hover:text-slate-950">
            About
          </Link>
          <Link href="/privacy" className="hover:text-slate-950">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-slate-950">
            Terms of Service
          </Link>
          <Link href="/contact" className="hover:text-slate-950">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  )
}

/** Deliberately placed before the instructions — people grant access more readily
 *  once they can see the exit. */
function RevokeFirst() {
  return (
    <section className="mt-12 rounded-lg border-2 border-slate-900 bg-white p-6">
      <h2 className="text-xl font-black">Before you start: how to undo any of this</h2>
      <p className="mt-3 text-sm leading-7 text-slate-600">
        Every step on this page can be reversed in under a minute, by you, without
        telling us first. Here is where each one lives, so you can see the exit before
        you use the entrance.
      </p>
      <dl className="mt-5 space-y-3 text-sm leading-6">
        {REVOKE_ROUTES.map(route => (
          <div key={route.label} className="sm:flex sm:gap-4">
            <dt className="font-bold text-slate-900 sm:w-56 sm:shrink-0">
              {route.label}
            </dt>
            <dd className="text-slate-600">{route.path}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function OverviewTable() {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-black">What we ask for, and why</h2>

      {/* Mobile: cards. A four-column table forces horizontal scrolling on a phone,
          which hides the two columns that reassure people most. */}
      <div className="mt-6 space-y-4 sm:hidden">
        {OVERVIEW.map(row => (
          <div
            key={row.platform}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">{row.platform}</h3>
              <span className="shrink-0 text-xs font-semibold text-slate-400">
                {row.time}
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{row.what}</p>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              <span className="font-semibold text-slate-700">How: </span>
              {row.how}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 hidden overflow-x-auto rounded-lg border border-slate-200 bg-white sm:block">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Account</th>
              <th className="px-5 py-3 font-semibold">What it lets us do</th>
              <th className="px-5 py-3 font-semibold">How you grant it</th>
              <th className="px-5 py-3 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-600">
            {OVERVIEW.map(row => (
              <tr key={row.platform}>
                <td className="px-5 py-4 font-semibold text-slate-900">
                  {row.platform}
                </td>
                <td className="px-5 py-4 leading-6">{row.what}</td>
                <td className="px-5 py-4 leading-6">{row.how}</td>
                <td className="px-5 py-4 whitespace-nowrap">{row.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function SectionShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string
  title: string
  intro: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-16">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-black">{title}</h2>
      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{intro}</p>
      {children}
    </section>
  )
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-5 rounded-lg bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
      {children}
    </p>
  )
}

function GoogleDataSection() {
  return (
    <SectionShell
      eyebrow="Step 1 — easiest"
      title="Google Search Console & Google Analytics"
      intro="This is the one that takes a single click. We send you a personal link; you sign in with Google and approve. That one approval covers both Search Console and Analytics."
    >
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-7 text-slate-600">
          <li>
            Open the connection link we sent you. It starts with{' '}
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
              {CONNECT_HOST}/connect/
            </span>{' '}
            and is unique to your business.
          </li>
          <li>Click <strong>Connect with Google</strong>.</li>
          <li>
            Sign in with the Google account that owns your Search Console and Analytics
            properties, and approve the request.
          </li>
          <li>
            The page turns green and shows the connected email address. That is it — you
            can close it.
          </li>
        </ol>
        <Callout>
          <strong className="text-slate-900">
            What this permission actually covers.
          </strong>{' '}
          We can read your search performance and traffic data, and we can tell Google
          when a page on your site is new or updated so it gets re-crawled sooner. That
          last one is a request to Google, not a change to your site. We cannot edit your
          website, and we cannot change anything in your Google account.
        </Callout>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          Do not have the link? Ask your Magic Engine contact and we will send a fresh
          one.
        </p>
      </div>
    </SectionShell>
  )
}

function BusinessProfileSection() {
  return (
    <SectionShell
      eyebrow="Step 2"
      title="Google Business Profile"
      intro="This is your listing on Google Maps and in local search results. Manager access lets us keep your hours, photos and details accurate, post updates, and handle reviews."
    >
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-7 text-slate-600">
          {GBP_STEPS.map(step => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Callout>
          <strong className="text-slate-900">On reviews — your call, not ours.</strong>{' '}
          Some owners want us replying on their behalf so nothing sits unanswered for a
          week. Others want to approve every word that goes out in their name. Tell us
          which you are and we will set it up that way. If you say nothing, we will bring
          replies to you before they are posted.
        </Callout>
        <Callout>
          <strong className="text-slate-900">Manager, not Owner.</strong> A Manager can
          edit and post. Only an Owner can transfer or delete the listing — and that
          stays you.
        </Callout>
      </div>
    </SectionShell>
  )
}

function MetaSection() {
  return (
    <SectionShell
      eyebrow="Step 3"
      title="Facebook & Instagram"
      intro="There are two ways to run your ads. Neither is wrong — pick the one that suits how you want your business to look on Facebook, and who you want the audience data to belong to afterwards."
    >
      <MetaOptions />
      <MetaWhichAreYou />
      <MetaSteps />
    </SectionShell>
  )
}

function MetaOptions() {
  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-2">
      <div className="rounded-lg border-2 border-slate-900 bg-white p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-cyan-700">
          Option A — recommended
        </p>
        <h3 className="mt-2 text-lg font-bold">Your Page, your ad account</h3>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Ads go out under your own Page. Every impression builds your Page&apos;s
          following and your own advertising history, which stays with you.
        </p>
        <ul className="mt-4 space-y-1.5 text-sm leading-6 text-slate-600">
          <li>· Ads appear from your Page</li>
          <li>· Audiences and pixel data accumulate in your account</li>
          <li>· Ad spend is billed to the card on your own ad account, so every dollar
            shows up in your own billing screen</li>
          <li>· Needs the one-time partner setup below</li>
        </ul>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
          Option B
        </p>
        <h3 className="mt-2 text-lg font-bold">Our ad account</h3>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          We run the campaign through our own business setup. Nothing to configure on
          your end.
        </p>
        <ul className="mt-4 space-y-1.5 text-sm leading-6 text-slate-600">
          <li>· No setup required from you</li>
          <li>· Fastest way to get a campaign live</li>
          <li>· Ad spend is billed to us and invoiced to you</li>
          <li>
            · If we stop working together, the audiences and ad history built during that
            time stay in our account, not yours
          </li>
        </ul>
      </div>
    </div>
  )
}

function MetaWhichAreYou() {
  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
      <h3 className="text-lg font-bold">First — which of these is you?</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        Option A needs a Business Portfolio: Meta&apos;s container for your Page and ad
        account. Most people who get stuck here get stuck because they do not have one
        and do not realise it.
      </p>
      <dl className="mt-5 space-y-4">
        {META_ROUTES.map(route => (
          <div key={route.label}>
            <dt className="text-sm font-bold text-slate-900">{route.label}</dt>
            <dd className="mt-1 text-sm leading-6 text-slate-600">{route.body}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function MetaSteps() {
  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
      <h3 className="text-lg font-bold">Setting up Option A</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        About five minutes, once. Meta&apos;s wording differs slightly between accounts —
        if a menu name does not match exactly, it will be close.
      </p>
      <ol className="mt-5 space-y-5">
        {META_STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-bold text-slate-900">{step.title}</p>
              <p className="mt-1 text-sm leading-6 text-slate-600">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-6 rounded-lg bg-slate-50 px-4 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Magic Engine Business Portfolio ID
        </p>
        <p className="mt-1.5 select-all font-mono text-xl font-bold tracking-wide text-slate-900">
          {META_BUSINESS_ID}
        </p>
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Meta should show the name <strong>Magic Engine</strong> after you paste this.
          Any other name means the ID was mistyped — do not continue.
        </p>
      </div>
      <Callout>
        <strong className="text-slate-900">About your budget.</strong> We never raise
        your daily or campaign budget without you agreeing to the new number first. We
        can pause, shift and reallocate inside a budget you have already approved — that
        is the point of giving us access — but the ceiling is yours to set and yours to
        change.
      </Callout>
    </div>
  )
}

function GoogleAdsSection() {
  return (
    <SectionShell
      eyebrow="Step 4 — only if we run your Google Ads"
      title="Google Ads"
      intro="Standard access lets us act on what we find — pause the keywords burning money, adjust bids, add negative keywords — instead of emailing you for a sign-off on each one."
    >
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <ol className="list-decimal space-y-3 pl-5 text-sm leading-7 text-slate-600">
          <li>
            In Google Ads, click <strong>Admin</strong> at the bottom of the left-hand
            menu, then open <strong>Access and security</strong>.
          </li>
          <li>On the Users tab, click the + button.</li>
          <li>
            Enter {INVITE_EMAIL} and set the access level to <strong>Standard</strong>.
          </li>
          <li>Send the invitation.</li>
        </ol>
        <Callout>
          <strong className="text-slate-900">Standard is not Admin.</strong> We cannot
          add or remove people from your account, we cannot link it to other accounts,
          and we cannot take you off your own account. If you would rather start us on
          read-only and upgrade once you have seen a month of the work, that is
          completely fine — just say so.
        </Callout>
        <Callout>
          If your account has more than three administrators, Google asks a second admin
          to approve the invitation before it takes effect. Worth a heads-up to whoever
          else has admin access, otherwise the invite sits there quietly.
        </Callout>
      </div>
    </SectionShell>
  )
}

function WebsiteSection() {
  return (
    <SectionShell
      eyebrow="Step 5"
      title="Your website backend"
      intro="Most of the SEO work happens on your own site — page titles, headings, internal links, schema markup, and publishing new content. Editor access means we can ship those fixes instead of emailing you a list of them."
    >
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <ul className="space-y-4 text-sm leading-7 text-slate-600">
          <li>
            <strong className="text-slate-900">WordPress</strong> — Users → Add New. It
            asks for a username (anything, for example &quot;magicengine&quot;) and an
            email — use {INVITE_EMAIL}. Leave the generated password as it is, keep
            &quot;Send User Notification&quot; ticked, set Role to <strong>Editor</strong>,
            and click Add New User. We set our own password from the email it sends. On
            WordPress.com the menu says Users → Invite New instead.
          </li>
          <li>
            <strong className="text-slate-900">Shopify</strong> — the tidiest route is a
            collaborator request, because it does not use up one of your staff seats:
            Settings → Users, allow collaborator requests, and send us your collaborator
            request code. Adding us as a staff user also works if your plan has a spare
            seat.
          </li>
          <li>
            <strong className="text-slate-900">Webflow, Squarespace, Wix</strong> —
            invite {INVITE_EMAIL} as a collaborator with editing rights.
          </li>
          <li>
            <strong className="text-slate-900">Something else</strong> — tell us what you
            are on and we will send the exact path for it.
          </li>
        </ul>
        <Callout>
          <strong className="text-slate-900">A note on Administrator.</strong> Editor
          covers content, page titles, headings and internal links, and it is what we ask
          for by default. Some technical fixes — plugins, redirects, page speed, schema —
          genuinely cannot be done at Editor level. WordPress Administrator does give
          full control of the site, including the ability to remove other users, so we
          will not ask for it up front. If we hit a job that needs it, we will ask you
          then, say exactly what it is for, and you can put us back to Editor the moment
          it is done.
        </Callout>
      </div>
    </SectionShell>
  )
}

function GuaranteesSection() {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-black">What this does and does not give us</h2>
      <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
        <ul className="space-y-4 text-sm leading-7 text-slate-600">
          {GUARANTEES.map(item => (
            <li key={item} className="flex gap-3">
              <span
                aria-hidden
                className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-600"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm leading-6 text-slate-500">
          How we handle the data these connections give us is set out in our{' '}
          <Link href="/privacy" className="text-indigo-600 underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </section>
  )
}

function ContactSection() {
  return (
    <section className="mt-16 rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-black">Stuck on any of it?</h2>
      <p className="mt-3 text-sm leading-7 text-slate-600">
        Plenty of people get stuck on the Facebook one — it is genuinely confusing, and
        Meta renames things every few months. Send a screenshot of where you are and we
        will sort it out, or we will jump on a call and do it with you.
      </p>
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="mt-5 inline-block rounded-lg bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
      >
        Email {CONTACT_EMAIL}
      </a>
      <p className="mt-6 text-xs leading-6 text-slate-500">
        Magic Engine is built and operated by <strong>Magic Engine AI Technology Limited</strong>, which is the
        name you will see on invoices and in the footer of this page. We contact you from{' '}
        <strong>magicengine.cloud</strong> and <strong>magicengine.com.au</strong>. If
        anyone asks for account access from a different domain, or asks for your
        password, it is not us — forward it to us and we will confirm.
      </p>
    </section>
  )
}
