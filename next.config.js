/** @type {import('next').NextConfig} */
/** Standalone Magic Network site; override with MAGIC_NETWORK_URL once the real domain is live. */
const MAGIC_NETWORK_URL = (process.env.MAGIC_NETWORK_URL || 'https://magic-network.onrender.com').replace(/\/+$/, '');

const nextConfig = {
  // Skip Next.js's own TS type-check pass — we run `tsc --noEmit` separately.
  // Needed because @supabase/phoenix ships a malformed .d.ts with an invalid
  // character at line 1, causing the built-in type check to fail even though
  // tsconfig.json has skipLibCheck: true.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    // Warnings from pre-existing <img> tags, etc. should not block deploy.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Next 14 does not load src/instrumentation.ts unless this is on.
    // That hook reuses PUT /api/inngest after a Render boot. No new secret.
    instrumentationHook: true,
    serverActions: {
      allowedOrigins: ['localhost:3000', 'localhost:3001'],
    },
  },
  // PR5 (docs/specs/2026-08-11-onboarding-integrations-unify-v1.md §2.4):
  // /connectors retired — everything it did now lives in one place, the
  // settings page's "connect" tab (GbpPanel/GscPanel/Ga4Panel/GoogleAdsPanel/
  // OtherDataSourcesPanel). Old bookmarks/hardcoded links must not 404.
  async redirects() {
    return [
      // Magic Network moved out of ME into its own site (PM 2026-11-10「Redirect now」). The public
      // product and application pages send visitors there; the query string (?ref=) is carried over.
      // Not permanent: the address changes again when the Magic Network domain is registered.
      // The distributor portal (/partner) stays here until the new site has its own database.
      {
        source: '/ai-steward',
        destination: `${MAGIC_NETWORK_URL}/products/ai-steward`,
        permanent: false,
      },
      {
        source: '/partner/apply',
        destination: `${MAGIC_NETWORK_URL}/join`,
        permanent: false,
      },
      {
        source: '/dashboard/clients/:id/connectors',
        destination: '/dashboard/clients/:id/settings?tab=connect',
        permanent: true,
      },
      {
        source: '/dashboard/clients/:id/connectors/:anchor',
        destination: '/dashboard/clients/:id/settings?tab=connect',
        permanent: true,
      },
    ]
  },
};

module.exports = nextConfig;
