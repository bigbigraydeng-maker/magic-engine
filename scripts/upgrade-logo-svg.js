/* Upgrade old polygon-style logo SVGs in all website HTML files to new VI 5-stem mark.
   Idempotent — running twice does nothing the second time.
   Run: node scripts/upgrade-logo-svg.js
*/
const fs = require('fs');
const path = require('path');

const WEBSITE_DIR = path.join(__dirname, '..', 'website');

// New VI logo — 5 converging gold streams + gold chip. Inline (no <use>) so
// every page renders standalone without needing shared SVG defs.
function buildNewSvg({ width, height, idSuffix, strokeWidth = 5.5, dotR = 3.5 }) {
  const gid = `meGrad_${idSuffix}`;
  const nid = `meNode_${idSuffix}`;
  return `<svg width="${width}" height="${height}" viewBox="0 0 100 100" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id="${gid}" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
              <stop stop-color="#EBCB8B"/><stop offset="0.55" stop-color="#C4912E"/><stop offset="1" stop-color="#A6781F"/>
            </linearGradient>
            <radialGradient id="${nid}" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.45" stop-color="#FBEFD2"/><stop offset="1" stop-color="#EBCB8B"/>
            </radialGradient>
          </defs>
          <rect width="100" height="100" rx="22" fill="#0D0D0D"/>
          <g stroke="url(#${gid})" fill="none" stroke-linecap="round" stroke-width="${strokeWidth}">
            <path d="M14,24 C38,30 56,44 78,52"/>
            <path d="M14,36 C38,40 56,46 78,52"/>
            <path d="M14,48 C40,50 56,50 78,52"/>
            <path d="M14,60 C40,58 56,56 78,52"/>
            <path d="M14,72 C38,66 56,60 78,52"/>
          </g>
          <g fill="url(#${gid})">
            <circle cx="14" cy="24" r="${dotR}"/><circle cx="14" cy="36" r="${dotR}"/><circle cx="14" cy="48" r="${dotR}"/><circle cx="14" cy="60" r="${dotR}"/><circle cx="14" cy="72" r="${dotR}"/>
          </g>
          <rect x="69" y="41" width="20" height="20" rx="5" fill="url(#${nid})"/>
        </svg>`;
}

// Match a whole old-logo <svg> block with the 5 fixed polygons.
// Greedy across newlines, but bounded by </svg>. The regex is anchored
// on the very specific "polygon points=\"3,60" string that only appears
// in the old logo, so we can't accidentally replace anything else.
const OLD_SVG_RE = /<svg\s+width="(\d+)"\s+height="(\d+)"\s+viewBox="0 0 68 64"\s+fill="none"\s+aria-hidden="true">\s*<polygon points="3,60[\s\S]*?<\/svg>/g;

function listHtmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listHtmlFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith('.html') ? [fullPath] : [];
  });
}

const files = listHtmlFiles(WEBSITE_DIR);
let totalReplacements = 0;
let filesChanged = 0;

for (const filePath of files) {
  const file = path.relative(WEBSITE_DIR, filePath);
  const src = fs.readFileSync(filePath, 'utf8');
  let i = 0;
  let changed = false;
  const out = src.replace(OLD_SVG_RE, (_match, w, h) => {
    i++;
    changed = true;
    // Make a unique id suffix per replacement per file so gradients don't collide
    const baseName = file.replace(/\.html$/, '');
    const idSuffix = `${baseName}_${i}`.replace(/[^a-zA-Z0-9_]/g, '_');
    return buildNewSvg({
      width: parseInt(w, 10),
      height: parseInt(h, 10),
      idSuffix,
    });
  });
  if (changed) {
    fs.writeFileSync(filePath, out, 'utf8');
    filesChanged++;
    totalReplacements += i;
    console.log(`  ${file}: ${i} logo(s) upgraded`);
  } else {
    console.log(`  ${file}: no old logo found (already upgraded or none present)`);
  }
}

console.log(`\nDone. Files changed: ${filesChanged}/${files.length}. Total logos upgraded: ${totalReplacements}.`);
