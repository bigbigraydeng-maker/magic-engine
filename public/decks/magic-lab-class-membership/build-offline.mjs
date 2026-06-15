#!/usr/bin/env node
// Build a fully self-contained, offline single-file version of the membership deck.
//
//   node build-offline.mjs
//
// Reads index.html (the served version, which references local assets/, vendor/
// lucide + the Google Fonts CDN) and inlines EVERYTHING into one HTML file that
// opens with no network:
//   - <img src="assets/x.png">         -> data: URI
//   - <script src="vendor/lucide…">    -> inlined <script>
//   - <script src="deck-stage.js">     -> inlined <script>
//   - Google Fonts <link>              -> @font-face with Poppins (Latin) inlined
//                                         as data: URIs + a system CJK fallback
//                                         stack (PingFang SC / Microsoft YaHei /
//                                         Noto Sans SC) so Chinese renders offline.
//
// Output: MagicLabClass-会员说明-offline.html (next to this script).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p));
const b64 = (p) => read(p).toString('base64');

let html = read('index.html').toString('utf8');

// 1 · Inline image assets referenced as assets/<file>
html = html.replace(/assets\/([\w.-]+\.(?:png|jpe?g|webp|gif|svg))/g, (_m, file) => {
  const ext = file.split('.').pop().toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'webp' ? 'image/webp'
    : ext === 'gif' ? 'image/gif'
    : 'image/png';
  return `data:${mime};base64,${b64(`assets/${file}`)}`;
});

// 2 · Replace the Google Fonts stylesheet + preconnects with inlined @font-face.
//     Poppins (Latin) is inlined; CJK falls back to installed system fonts.
const poppins = [500, 600, 700, 800].map((w) => `@font-face{font-family:'Poppins';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64(`vendor/fonts/poppins-${w}.woff2`)}) format('woff2');}`).join('\n');
const fontCss = `<style>\n${poppins}\n/* Chinese text uses the viewer's installed CJK font (PingFang SC on macOS, Microsoft YaHei on Windows, Noto Sans SC if present). */\nbody{font-synthesis:weight;}\n</style>`;

html = html
  .replace(/<link rel="preconnect"[^>]*>\s*/g, '')
  .replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, fontCss);

// Make every "'Noto Sans SC'" font stack resolve through the system fallback list
// so offline viewers without Noto installed still get a clean CJK render.
html = html.replace(/'Noto Sans SC'/g, "'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif");

// 3 · Inline the vendored scripts (lucide, then deck-stage) in place.
//     Escape any literal `</script>` inside the JS (deck-stage.js's docstring
//     contains one) so it can't prematurely terminate the inlined block. In a
//     JS string/regex `<\/script>` is identical to `</script>`; in a comment
//     it's harmless text — either way the HTML parser no longer sees a close.
const inlineScript = (src, file) => {
  const js = read(file).toString('utf8').replace(/<\/script/gi, '<\\/script');
  return html.replace(
    new RegExp(`<script src="${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"></script>`),
    `<script>\n${js}\n</script>`
  );
};
html = inlineScript('vendor/lucide.min.js', 'vendor/lucide.min.js');
html = inlineScript('deck-stage.js', 'deck-stage.js');

const out = 'MagicLabClass-会员说明-offline.html';
writeFileSync(join(here, out), html, 'utf8');

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
// Only flag refs in real markup — ignore any src=/href= strings inside inlined
// <script> blocks (e.g. deck-stage.js's docstring usage example), which are
// inert text, not external loads.
const markup = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const leftovers = [...markup.matchAll(/(?:src|href)="(?!data:|#)([^"]+)"/g)].map((m) => m[1]);
console.log(`✓ ${out} (${kb} KB)`);
if (leftovers.length) console.warn('⚠ remaining external refs:', [...new Set(leftovers)]);
else console.log('✓ fully self-contained — no external src/href refs remain');
