/**
 * Inlines repo /icons/*.svg into the library as BRAND_FILE_TYPE_SVGS.
 * Run from repo root: node scripts/inline-brand-icons.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'icons');
const outFile = path.join(
  root,
  'projects/whitecap-file-manager/src/lib/brand-file-type-svgs.ts',
);

function cleanSvg(raw) {
  let s = raw
    .replace(/<\?xml[^?]*\?>\s*/gi, '')
    .replace(/<!DOCTYPE[^>]*>\s*/gi, '')
    .trim();
  const inner = s.replace(/^<svg[\s\S]*?>/, '').replace(/<\/svg>\s*$/i, '');
  return `<svg class="wcfm-brand-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

const mapping = [
  ['filetype-pdf.svg', 'pdf'],
  ['filetype-word.svg', 'word'],
  ['filetype-presentation.svg', 'presentation'],
  ['filetype-spreadsheet.svg', 'spreadsheet'],
  ['filetype-image.svg', 'image'],
  ['filetype-video.svg', 'video'],
  ['filetype-audio.svg', 'audio'],
  ['filetype-archive.svg', 'archive'],
  ['filetype-text.svg', 'text'],
  ['filetype-unknown.svg', 'unknown'],
  ['filetype-folder.svg', 'folder'],
  ['filetype-link.svg', 'link'],
];

const entries = [];
for (const [file, key] of mapping) {
  const full = path.join(iconsDir, file);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing ${full}`);
  }
  const cleaned = cleanSvg(fs.readFileSync(full, 'utf8'));
  entries.push(`  ${key}: ${JSON.stringify(cleaned)}`);
}

const banner = `/* Auto-generated from repo /icons — run: node scripts/inline-brand-icons.mjs */\n`;
const body = `export const BRAND_FILE_TYPE_SVGS = {\n${entries.join(',\n')},\n} as const;\n\nexport type BrandFileTypeSvgKey = keyof typeof BRAND_FILE_TYPE_SVGS;\n`;

fs.writeFileSync(outFile, banner + body, 'utf8');
console.log('Wrote', outFile);
