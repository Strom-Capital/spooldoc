#!/usr/bin/env node
/**
 * Makes public/og.png, the 1280 x 640 share image: the horizontal logo from the app's
 * brand folder and the line "Spooled files into documents, for IBM i." on the brand
 * background. Run it when the logo or the line changes, and commit the PNG:
 * `pnpm --filter @spooldoc/site og`.
 *
 * Fonts come from fontsource (Montserrat 600 for the wordmark, Geist for the line).
 * resvg reads TrueType files from disk, so the WOFF files are unpacked to TrueType in a
 * temporary folder first. These
 * static cuts name their family with the weight ("Montserrat SemiBold"), so the SVG
 * asks for those names.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);

const WIDTH = 1280;
const HEIGHT = 640;
const LINE = 'Spooled files into documents, for IBM i.';

/** A WOFF 1.0 file as the TrueType or OpenType font inside it. */
function woffToSfnt(woff) {
  if (woff.toString('latin1', 0, 4) !== 'wOFF') throw new Error('Not a WOFF 1.0 file.');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    const tag = woff.toString('latin1', at, at + 4);
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const checksum = woff.readUInt32BE(at + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? zlib.inflateSync(raw) : raw;
    tables.push({ tag, checksum, data });
  }
  let searchRange = 1;
  let entrySelector = 0;
  while (searchRange * 2 <= numTables) {
    searchRange *= 2;
    entrySelector++;
  }
  searchRange *= 16;
  const header = Buffer.alloc(12 + numTables * 16);
  header.writeUInt32BE(flavor, 0);
  header.writeUInt16BE(numTables, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(numTables * 16 - searchRange, 10);
  const bodies = [];
  let offset = header.length;
  tables.forEach((table, i) => {
    const at = 12 + i * 16;
    header.write(table.tag, at, 'latin1');
    header.writeUInt32BE(table.checksum, at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(table.data.length, at + 12);
    const padded = Buffer.alloc((table.data.length + 3) & ~3);
    table.data.copy(padded);
    bodies.push(padded);
    offset += padded.length;
  });
  return Buffer.concat([header, ...bodies]);
}

const fontFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'spooldoc-og-'));
const fontFiles = ['@fontsource/montserrat/files/montserrat-latin-600-normal.woff', '@fontsource/geist/files/geist-latin-500-normal.woff'].map((file) => {
  const out = path.join(fontFolder, path.basename(file, '.woff') + '.ttf');
  fs.writeFileSync(out, woffToSfnt(fs.readFileSync(require.resolve(file))));
  return out;
});

const logo = fs
  .readFileSync(new URL('../web/public/brand/spooldoc-horizontal-light.svg', root), 'utf8')
  .replace(/<\?xml[^>]*>/, '')
  .replace(/<svg\b[^>]*>/, '<svg x="0" y="0" width="760" height="174" viewBox="0 0 455 104">')
  .replace(/font-family="[^"]*"/, 'font-family="Montserrat SemiBold"');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>
  <rect x="0" y="${HEIGHT - 16}" width="${WIDTH}" height="16" fill="#3159e8"/>
  <g transform="translate(86 150)">${logo}</g>
  <text x="128" y="420" fill="#0f0f0f" font-family="Geist Medium" font-weight="500" font-size="50" letter-spacing="-1">${LINE}</text>
  <text x="128" y="486" fill="#60615e" font-family="Geist Medium" font-weight="500" font-size="32">Open output management.</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: 'width', value: WIDTH },
  font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Geist Medium' },
}).render().asPng();

fs.rmSync(fontFolder, { recursive: true, force: true });
fs.writeFileSync(new URL('public/og.png', root), png);
console.log(`Wrote public/og.png (${WIDTH} x ${HEIGHT}, ${Math.round(png.length / 1024)} KB).`);
