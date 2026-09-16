// Park Homes — 5 developments. Single source of truth.
// All figures supplied by the client (intake 2026-07-19). Addresses kept verbatim as provided.
// images: [] means no client renders yet → the site renders a branded placeholder automatically.

export const projects = [
  {
    slug: 'riverside',
    name: 'Riverside',
    status: 'Now Selling',
    pill: 'pill-sell',
    eyebrow: 'Rosehill · Auckland',
    tagline: 'Tranquil Surroundings. Contemporary Living.',
    cardLine: '104 homes along a river corridor, Park Estate Road, Rosehill.',
    listLine: '104 homes along a river corridor, Park Estate Road, Rosehill. Two to five bedrooms.',
    price: 'From $650k',
    metaDescription: '104 new homes from $650k in a masterplanned riverside community, Park Estate Road, Rosehill. Two to five bedrooms — now selling.',
    heading: 'A masterplanned community on Park Estate Road',
    // Official copy — from parkhomes.nz/projects
    intro: [
      'Park Homes Riverside is a masterplanned residential community centred around a landscaped river corridor that weaves through the heart of the neighbourhood.',
      'Thoughtfully designed streetscapes, open green areas, and riverside walkways create a connected living environment where nature and contemporary homes coexist seamlessly.',
      'Built with disciplined project coordination and rigorous quality supervision, Riverside reflects our capability to deliver large-scale communities with both vision and precision — shaping not just homes, but an enduring neighbourhood.',
    ],
    facts: [
      ['Homes', '104'],
      ['Bedrooms', '2 – 5'],
      ['Homes from', '$650k'],
      ['Completion', '2026 – 28'],
    ],
    footerAddress: 'Riverside · 115 Park Estate Road, Rosehill, Auckland',
    group: 'available',
    // 2026-08-21: replacement aerials supplied by the client, cropped to the
    // completed section of this multi-stage site and colour-corrected (no
    // structures removed/altered) — the wider originals also show other
    // stages still under construction, which is why the crop is tight.
    hero: '/img/riverside/rv-aerial-finished-1.webp',
    card: '/img/riverside/rv-aerial-finished-1.webp',
    imageNote: 'Site photography supplied by the developer, cropped to the completed section of this multi-stage development.',
    images: [
      { src: '/img/riverside/rv-aerial-finished-1.webp', alt: 'Riverside — completed homes, aerial view', wide: true },
      { src: '/img/riverside/rv-aerial-finished-2.webp', alt: 'Riverside — completed homes, aerial view' },
      { src: '/img/riverside/rv-aerial-finished-3.webp', alt: 'Riverside — completed homes, aerial view' },
    ],
    // Supplied by the client (Jason, 2026-09-15) via email — YouTube walkthrough of 115 Park Estate Road.
    video: { youtubeId: 'VqKlqhGUJEQ', title: 'Riverside — 115 Park Estate Road' },
    // Riverside is a masterplanned community — individual lots list under their
    // own internal street names (Aratuhia Lane, Longview Oak Lane), not "Park
    // Estate Road" itself, and suburb tagging is inconsistent between listings
    // (some "Rosehill", some "Papakura") so a keyword search misses results.
    // PM-confirmed live listing 2026-08-21, one of many lots in this development.
    listingsSearchUrl: 'https://www.raywhite.co.nz/auckland/papakura/papakura/MSB31949',
    listingsLabel: 'View a current listing on Ray White →',
    relatedArticles: [
      { title: 'Drury-Opāheke Growth and What It Means for Rosehill Property Buyers', href: '/journal/drury-growth-rosehill-papakura-property/' },
      { title: 'Papakura rental yields: why investors are looking south of Auckland', href: '/journal/papakura-rental-yield-investment-guide/' },
      { title: "Rosehill and Papakura, Auckland: a buyer's data guide", href: '/journal/rosehill-papakura-suburb-data-guide/' },
    ],
  },
  {
    slug: 'howick',
    name: 'Howick',
    status: 'Now Selling',
    pill: 'pill-sell',
    eyebrow: 'Howick · East Auckland',
    tagline: 'Modern Comfort in a Well-Established Community',
    cardLine: 'Five homes on Libby Lane, Howick.',
    listLine: 'Five homes on Libby Lane, Howick. Three to four bedrooms, 125.5–150m².',
    price: 'From $900k',
    metaDescription: 'Five architecturally considered homes in Howick, East Auckland. Three to four bedrooms, 125.5–150m², from $900k — now selling.',
    heading: 'Modern comfort in a well-established community',
    // Official copy — from parkhomes.nz/projects
    intro: [
      'Situated in the heart of East Auckland, our Howick development blends contemporary architecture with neighbourhood charm.',
      'Spacious interiors, carefully selected materials, and thoughtful floorplans ensure each home delivers comfort, functionality, and lasting appeal.',
      'Built with precision and supported by a strong construction network, this boutique release reflects Park Homes’ commitment to excellence.',
    ],
    // Facts cross-checked 2026-08-19 against the live TradeMe + Ray White listings
    // (Roman Hu, Ray White Mission Bay) — those are treated as the source of truth
    // over the earlier "Bulk Listings Extra Info Sheet", which had Lot 2 down as
    // 3-bath; the live listing says 2-bath. Size range matches both portals'
    // listing copy verbatim: "Approximately 125.5sqm-150sqm of floor area".
    facts: [
      ['Homes', '5'],
      ['Bedrooms', '3 – 4'],
      ['Size', '125.5–150 m²'],
      ['From', '$900k'],
    ],
    footerAddress: 'Howick · 3 Libby Lane, Howick, Auckland',
    group: 'available',
    hero: '/img/howick/hw-street-front.webp',
    card: '/img/howick/hw-street-front.webp',
    imageNote: 'Site photography supplied by the developer.',
    images: [
      { src: '/img/howick/hw-street-front.webp',      alt: 'Howick — completed homes, street view', wide: true },
      { src: '/img/howick/hw-street-side.webp',       alt: 'Howick — completed homes, side view' },
      { src: '/img/howick/hw-aerial-finished-1.webp', alt: 'Howick — completed homes, aerial view' },
      { src: '/img/howick/hw-aerial-finished-2.webp', alt: 'Howick — completed homes, aerial view' },
      { src: '/img/howick/hw-context-aerial.webp',    alt: 'Howick — the established East Auckland neighbourhood' },
    ],
    // Individual floor plans, supplied by Roman Hu (Ray White Mission Bay) via the
    // client. Specs cross-checked against the live TradeMe + Ray White listings
    // 2026-08-19 — Lots 1–4 are currently listed for sale; Lot 5 is not (its specs
    // come from the Bulk Listings sheet only, so it's kept unlisted-but-shown here).
    floorPlans: [
      { src: '/img/howick/floorplans/hw-fp-lot1.webp', lot: 'Lot 1', beds: 3, baths: 3, floorArea: '132 m²', landArea: '179 m²', listingUrl: 'https://www.raywhite.co.nz/auckland/manukau-city/howick/MSB31981' },
      { src: '/img/howick/floorplans/hw-fp-lot2.webp', lot: 'Lot 2', beds: 4, baths: 2, floorArea: '150 m²', landArea: '145 m²', listingUrl: 'https://www.raywhite.co.nz/auckland/manukau-city/howick/MSB31982' },
      { src: '/img/howick/floorplans/hw-fp-lot3.webp', lot: 'Lot 3', beds: 3, baths: 2, floorArea: '125.5 m²', landArea: '130 m²', listingUrl: 'https://www.raywhite.co.nz/auckland/manukau-city/howick/MSB31983' },
      { src: '/img/howick/floorplans/hw-fp-lot4.webp', lot: 'Lot 4', beds: 3, baths: 2, floorArea: '125.7 m²', landArea: '134 m²', listingUrl: 'https://www.raywhite.co.nz/auckland/manukau-city/howick/MSB31980' },
      { src: '/img/howick/floorplans/hw-fp-lot5.webp', lot: 'Lot 5', beds: 4, baths: 2, floorArea: '142.7 m²', landArea: '386 m²', listingUrl: null },
    ],
    // Aggregate search — deliberately not one specific lot, since which lots are
    // still available changes over time; this always reflects what's actually live.
    listingsSearchUrl: 'https://www.raywhite.co.nz/listing?keywords=Libby%20Lane',
    relatedArticles: [
      { title: "Howick's population growth: what it means for the property market", href: '/journal/howick-population-growth-property-market/' },
      { title: 'Why Howick commands some of Auckland’s highest rents', href: '/journal/howick-rental-market-new-build-buyers/' },
      { title: "East Auckland's infrastructure and growth outlook: what it means for Howick buyers", href: '/journal/howick-infrastructure-growth-outlook/' },
    ],
  },
  {
    slug: 'castor-bay',
    name: 'Castor Bay',
    status: 'Register Interest',
    pill: 'pill-reg',
    eyebrow: 'Castor Bay · North Shore',
    tagline: 'Coastal Living. Elevated Design.',
    cardLine: 'Four large five-bedroom homes near Castor Bay.',
    listLine: 'Four large five-bedroom homes near Castor Bay. 260–280m².',
    price: '$2m+',
    metaDescription: 'Four boutique five-bedroom homes moments from Castor Bay beach, North Shore. 260–280m², from $2m+. Register your interest today.',
    heading: 'Coastal living. Elevated design.',
    // Official copy — from parkhomes.nz/projects
    intro: [
      'Located in one of the North Shore’s most desirable seaside suburbs, our Castor Bay development offers refined contemporary homes just moments from the beach.',
      'Designed to maximise natural light and coastal surroundings, these residences feature functional layouts, quality finishes, and timeless architectural appeal.',
      'A boutique collection crafted for families seeking lifestyle, schooling, and long-term value.',
    ],
    facts: [
      ['Homes', '4'],
      ['Bedrooms', '5'],
      ['Size', '260–280 m²'],
      ['From', '$2m+'],
    ],
    footerAddress: 'Castor Bay · 76a Beamor Rd',
    group: 'coming',
    // Client-supplied renders (2026-07-23)
    hero: '/img/castor-bay/cb-hero.webp',
    card: '/img/castor-bay/cb-home-dusk.webp',
    images: [
      { src: '/img/castor-bay/cb-hero.webp',           alt: 'Castor Bay — the development at dusk', wide: true },
      { src: '/img/castor-bay/cb-street-day.webp',     alt: 'Castor Bay — street view by day' },
      { src: '/img/castor-bay/cb-elevation-dusk.webp', alt: 'Castor Bay — elevation at dusk' },
      { src: '/img/castor-bay/cb-front-tall.webp',     alt: 'Castor Bay — front elevation' },
      { src: '/img/castor-bay/cb-home-dusk.webp',      alt: 'Castor Bay — individual home at dusk' },
      { src: '/img/castor-bay/cb-block-dusk.webp',     alt: 'Castor Bay — homes at dusk' },
      { src: '/img/castor-bay/cb-slope.webp',          alt: 'Castor Bay — hillside outlook' },
      { src: '/img/castor-bay/cb-garage-dusk.webp',    alt: 'Castor Bay — entry and garaging at dusk' },
      { src: '/img/castor-bay/cb-garage-day.webp',     alt: 'Castor Bay — entry and garaging by day' },
    ],
  },
  {
    slug: 'forrest-hill',
    name: 'Forrest Hill',
    status: 'Register Interest',
    pill: 'pill-reg',
    eyebrow: 'Forrest Hill · North Shore',
    tagline: 'Smart Family Living in a Prime School Zone',
    cardLine: 'Four four-to-five-bedroom homes, Forrest Hill Road.',
    listLine: 'Four four-to-five-bedroom homes, Forrest Hill Road. Around 200m². RC approved.',
    price: '$1.8m+',
    metaDescription: 'Four four-to-five-bedroom family homes on Forrest Hill Road, North Shore — resource consent approved, around 200m², from $1.8m+.',
    heading: 'Smart family living in a prime school zone',
    // Official copy — from parkhomes.nz/projects
    intro: [
      'Positioned in a well-established North Shore community, our Forrest Hill project focuses on practical modern living.',
      'With strong school zoning and convenient access to transport and amenities, these homes are designed for growing families and long-term homeowners.',
      'Every detail — from structural integrity to interior finishes — reflects our disciplined quality control and efficient delivery standards.',
    ],
    facts: [
      ['Homes', '4'],
      ['Bedrooms', '4 – 5'],
      ['Size', '~200 m²'],
      ['From', '$1.8m+'],
    ],
    footerAddress: 'Forrest Hill · 129 Forrest Hill Rd',
    group: 'coming',
    // Client-supplied renders (2026-09-12, via email).
    hero: '/img/forrest-hill/fh-render-1.webp',
    card: '/img/forrest-hill/fh-render-1.webp',
    images: [
      { src: '/img/forrest-hill/fh-render-1.webp', alt: 'Forrest Hill — artist’s impression', wide: true },
      { src: '/img/forrest-hill/fh-render-2.webp', alt: 'Forrest Hill — artist’s impression' },
      { src: '/img/forrest-hill/fh-render-3.webp', alt: 'Forrest Hill — artist’s impression' },
      { src: '/img/forrest-hill/fh-render-4.webp', alt: 'Forrest Hill — artist’s impression' },
    ],
  },
  {
    slug: 'greenview',
    name: 'Greenview',
    status: 'Under Construction',
    pill: 'pill-build',
    eyebrow: 'Reynolds Road · Auckland',
    tagline: 'Elevated Living. Beyond Expectations.',
    cardLine: 'Ten three-to-four-bedroom homes, Reynolds Road.',
    listLine: 'Ten three-to-four-bedroom homes, Reynolds Road. Consents approved.',
    price: 'From $750k',
    metaDescription: 'Ten three-to-four-bedroom homes on Reynolds Road with consents approved, around 140m², from $750k. An elevated, green outlook.',
    heading: 'Elevated living. Beyond expectations.',
    // Copy adapted from parkhomes.nz/projects.
    // RESOLVED (PM ruling, 2026-07-23): Jason's intake form is the authoritative source.
    // Greenview = 10 homes, 3–4 bed, ~140m². The old website wording ("a singular statement /
    // standalone project / the residence") is OUT OF DATE and deliberately not used here.
    // NOTE: the client's live Google Sites page still carries that incorrect wording.
    intro: [
      'Perched on an elevated hillside site, Greenview overlooks an expansive stretch of protected green space — offering privacy, openness, and uninterrupted views rarely found in suburban settings.',
      'Designed to embrace light and landscape, Greenview balances contemporary architecture with practical functionality. Generous glazing, open-plan interiors, and refined finishes create homes that feel both grounded and elevated.',
      'A carefully delivered project that reflects disciplined planning, strong supplier integration, and precise project execution.',
    ],
    facts: [
      ['Homes', '10'],
      ['Bedrooms', '3 – 4'],
      ['Size', '~140 m²'],
      ['From', '$750k'],
    ],
    footerAddress: 'Greenview · 10–12 Reynolds Rd, Pokihui',
    group: 'coming',
    // Client-supplied renders (2026-08-31). A third supplied photo (active
    // earthworks) is excluded from public display per the no-construction-
    // imagery policy applied sitewide to Riverside/Howick — moved out of
    // web/public (see ../../renders-raw/gv-earthworks-unused.webp) so it is
    // not copied into the deployed site.
    hero: '/img/greenview/gv-render-1.webp',
    card: '/img/greenview/gv-render-1.webp',
    images: [
      { src: '/img/greenview/gv-render-1.webp', alt: 'Greenview — artist’s impression', wide: true },
      { src: '/img/greenview/gv-render-2.webp', alt: 'Greenview — artist’s impression' },
    ],
  },
];

export const bySlug = (s) => projects.find((p) => p.slug === s);
export const featured = ['riverside', 'howick', 'castor-bay'];

// Official "The Park Homes Collection" copy — from parkhomes.nz/projects
export const collection = {
  title: 'The Park Homes Collection',
  subtitle: 'Our Signature Series Across Auckland',
  body: [
    'The Park Homes Collection represents our signature series of boutique developments across Auckland — a refined portfolio of thoughtfully designed homes created with care, precision, and purpose.',
    'Each project within our collection is carefully curated rather than mass produced. From architectural planning and layout optimisation to material selection and final detailing, every stage is managed with disciplined quality control and close supervision.',
    'We are committed to delivering homes that reflect intelligent design, practical functionality, and long-term value. Backed by a strong and reliable industry network, our streamlined construction processes allow us to maintain high efficiency and accelerated build timelines without compromising craftsmanship.',
    'At Park Homes, every development is a considered release — built with intention, supported by experience, and delivered to a standard our clients can trust.',
  ],
};

// Regions Park Homes builds in — drives the "Where we build" brand section
// and the by-area lead capture for upcoming South & West Auckland developments.
export const areas = [
  { region: 'North Shore',    slugs: ['castor-bay', 'forrest-hill'], status: 'building', blurb: 'Coastal and family homes across the East Coast Bays.' },
  { region: 'East Auckland',  slugs: ['howick'],                      status: 'building', blurb: 'Boutique homes in established eastern suburbs.' },
  { region: 'South Auckland', slugs: ['riverside', 'greenview'],      status: 'building', blurb: 'Masterplanned communities in Auckland’s growth corridor.' },
  { region: 'West Auckland',  slugs: [],                              status: 'coming',   blurb: 'New developments coming — register your interest early.', area: 'west' },
];
