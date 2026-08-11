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
    cardLine: '107 homes along a river corridor, Park Estate Road, Rosehill.',
    listLine: '107 homes along a river corridor, Park Estate Road, Rosehill. Two to five bedrooms.',
    price: 'From $650k',
    heading: 'A masterplanned community on Park Estate Road',
    // Official copy — from parkhomes.nz/projects
    intro: [
      'Park Homes Riverside is a masterplanned residential community centred around a landscaped river corridor that weaves through the heart of the neighbourhood.',
      'Thoughtfully designed streetscapes, open green areas, and riverside walkways create a connected living environment where nature and contemporary homes coexist seamlessly.',
      'Built with disciplined project coordination and rigorous quality supervision, Riverside reflects our capability to deliver large-scale communities with both vision and precision — shaping not just homes, but an enduring neighbourhood.',
    ],
    facts: [
      ['Homes', '107'],
      ['Bedrooms', '2 – 5'],
      ['Homes from', '$650k'],
      ['Completion', '2026 – 28'],
    ],
    footerAddress: 'Riverside · 115 Park Estate Road, Rosehill, Auckland',
    group: 'available',
    hero: '/img/riverside/rv-masterplan.jpg',
    card: '/img/riverside/rv-aerial-build.jpg',
    imageNote: 'Masterplan and site photography supplied by the developer. Masterplan indicative only.',
    images: [
      { src: '/img/riverside/rv-masterplan.jpg',      alt: 'Riverside — masterplan of the community', wide: true },
      { src: '/img/riverside/rv-aerial-build.jpg',    alt: 'Riverside — homes under construction, aerial view' },
      { src: '/img/riverside/rv-aerial-motorway.jpg', alt: 'Riverside — the site in its wider setting' },
      { src: '/img/riverside/rv-earthworks.jpg',      alt: 'Riverside — earthworks and civil construction' },
    ],
  },
  {
    slug: 'howick',
    name: 'Howick',
    status: 'Under Construction',
    pill: 'pill-build',
    eyebrow: 'Howick · East Auckland',
    tagline: 'Modern Comfort in a Well-Established Community',
    cardLine: 'Five homes on Libby Lane, Howick.',
    listLine: 'Five homes on Libby Lane, Howick. Three to four bedrooms, 130–149m².',
    price: 'From $900k',
    heading: 'Modern comfort in a well-established community',
    // Official copy — from parkhomes.nz/projects
    intro: [
      'Situated in the heart of East Auckland, our Howick development blends contemporary architecture with neighbourhood charm.',
      'Spacious interiors, carefully selected materials, and thoughtful floorplans ensure each home delivers comfort, functionality, and lasting appeal.',
      'Built with precision and supported by a strong construction network, this boutique release reflects Park Homes’ commitment to excellence.',
    ],
    facts: [
      ['Homes', '5'],
      ['Bedrooms', '3 – 4'],
      ['Size', '130–149 m²'],
      ['From', '$900k'],
    ],
    footerAddress: 'Howick · 3 Libby Lane, Howick, Auckland',
    group: 'available',
    hero: '/img/howick/hw-render-dusk.jpg',
    card: '/img/howick/hw-aerial-complete.jpg',
    imageNote: 'Renders and site photography supplied by the developer.',
    images: [
      { src: '/img/howick/hw-render-dusk.jpg',     alt: 'Howick — contemporary home at dusk', wide: true },
      { src: '/img/howick/hw-aerial-complete.jpg', alt: 'Howick — completed homes, aerial view' },
      { src: '/img/howick/hw-slope.jpg',           alt: 'Howick — homes in their landscaped setting' },
      { src: '/img/howick/hw-context-aerial.jpg',  alt: 'Howick — the established East Auckland neighbourhood' },
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
    hero: '/img/castor-bay/cb-hero.jpg',
    card: '/img/castor-bay/cb-home-dusk.jpg',
    images: [
      { src: '/img/castor-bay/cb-hero.jpg',           alt: 'Castor Bay — the development at dusk', wide: true },
      { src: '/img/castor-bay/cb-street-day.jpg',     alt: 'Castor Bay — street view by day' },
      { src: '/img/castor-bay/cb-elevation-dusk.jpg', alt: 'Castor Bay — elevation at dusk' },
      { src: '/img/castor-bay/cb-front-tall.jpg',     alt: 'Castor Bay — front elevation' },
      { src: '/img/castor-bay/cb-home-dusk.jpg',      alt: 'Castor Bay — individual home at dusk' },
      { src: '/img/castor-bay/cb-block-dusk.jpg',     alt: 'Castor Bay — homes at dusk' },
      { src: '/img/castor-bay/cb-slope.jpg',          alt: 'Castor Bay — hillside outlook' },
      { src: '/img/castor-bay/cb-garage-dusk.jpg',    alt: 'Castor Bay — entry and garaging at dusk' },
      { src: '/img/castor-bay/cb-garage-day.jpg',     alt: 'Castor Bay — entry and garaging by day' },
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
    footerAddress: 'Forrest Hill · 129 Forest Hill Rd',
    group: 'coming',
    images: [],
  },
  {
    slug: 'greenview',
    name: 'Greenview',
    status: 'Planning',
    pill: 'pill-build',
    eyebrow: 'Reynolds Road · Auckland',
    tagline: 'Elevated Living. Beyond Expectations.',
    cardLine: 'Ten three-to-four-bedroom homes, Reynolds Road.',
    listLine: 'Ten three-to-four-bedroom homes, Reynolds Road. Consents approved.',
    price: 'From $750k',
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
    images: [],
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
