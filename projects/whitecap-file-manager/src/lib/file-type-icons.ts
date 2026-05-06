import { SafeHtml } from '@angular/platform-browser';
import { BRAND_FILE_TYPE_SVGS } from './brand-file-type-svgs';
import { WhitecapFileItem } from './models';

export type FileIconKind =
  | 'pdf'
  | 'word'
  | 'slides'
  | 'spreadsheet'
  | 'image'
  | 'video'
  | 'audio'
  | 'archive'
  | 'code'
  | 'json'
  | 'xml'
  | 'text'
  | 'markdown'
  | 'font'
  | 'vector'
  | 'database'
  | 'executable'
  | 'link'
  | 'generic';

const stroked = (inner: string): string =>
  `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

function normalizeExt(item: Pick<WhitecapFileItem, 'extension' | 'name'>): string {
  let ext = (item.extension ?? '').trim().toLowerCase();
  if (ext.startsWith('.')) {
    ext = ext.slice(1);
  }
  if (!ext && item.name.includes('.')) {
    ext = item.name.split('.').pop()!.toLowerCase();
  }
  return ext;
}

export function resolveFileIconKind(
  item: Pick<WhitecapFileItem, 'type' | 'extension' | 'mimeType' | 'name'>,
): FileIconKind {
  if (item.type !== 'file') {
    return 'generic';
  }

  const ext = normalizeExt(item);
  const mime = (item.mimeType ?? '').toLowerCase();

  if (
    ['url', 'lnk', 'webloc', 'desktop', 'website', 'inetloc'].includes(ext) ||
    mime.includes('ms-shortcut') ||
    mime.includes('inode/symlink') ||
    mime === 'application/x-ms-shortcut'
  ) {
    return 'link';
  }

  if (mime.includes('pdf') || ext === 'pdf') return 'pdf';
  if (mime.includes('wordprocessingml') || ['doc', 'docx', 'dot', 'dotx', 'odt', 'rtf'].includes(ext)) {
    return 'word';
  }
  if (
    mime.includes('presentationml') ||
    mime.includes('vnd.apple.keynote') ||
    ['ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key'].includes(ext)
  ) {
    return 'slides';
  }
  if (
    mime.includes('spreadsheetml') ||
    ['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv', 'numbers'].includes(ext)
  ) {
    return 'spreadsheet';
  }
  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'jpe', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'heic', 'avif', 'heif', 'psd'].includes(ext)) {
    return 'image';
  }
  if (mime.startsWith('video/') || ['mp4', 'm4v', 'mov', 'avi', 'wmv', 'webm', 'mkv', 'flv', 'ogv', 'mpeg', 'mpg', '3gp'].includes(ext)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'opus', 'aiff', 'aif', 'mid', 'midi'].includes(ext)) {
    return 'audio';
  }
  if (
    mime.includes('zip') ||
    mime.includes('compressed') ||
    mime.includes('x-rar') ||
    mime.includes('x-7z') ||
    ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'lz', 'zst', 'cab'].includes(ext)
  ) {
    return 'archive';
  }
  if (['json', 'jsonl', 'ndjson'].includes(ext) || mime.includes('json')) return 'json';
  if (['xml', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'plist', 'wsdl'].includes(ext) || mime.includes('xml')) {
    return 'xml';
  }
  if (['md', 'mdx', 'markdown'].includes(ext)) return 'markdown';
  if (['txt', 'log', 'diff', 'patch', 'nfo', 'readme'].includes(ext) || mime === 'text/plain') {
    return 'text';
  }
  if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(ext) || mime.includes('font')) return 'font';
  if (['ai', 'eps', 'sketch', 'fig'].includes(ext)) return 'vector';
  if (['sql', 'sqlite', 'db', 'mdb'].includes(ext) || mime.includes('sql')) return 'database';
  if (
    ['exe', 'dmg', 'pkg', 'msi', 'deb', 'rpm', 'apk', 'app', 'bin', 'dll', 'so', 'dylib'].includes(ext) ||
    mime.includes('x-msdownload') ||
    mime.includes('x-executable')
  ) {
    return 'executable';
  }

  const codeLike = new Set([
    'js',
    'mjs',
    'cjs',
    'ts',
    'jsx',
    'tsx',
    'vue',
    'svelte',
    'html',
    'htm',
    'css',
    'scss',
    'sass',
    'less',
    'styl',
    'py',
    'rb',
    'php',
    'java',
    'c',
    'h',
    'cpp',
    'cc',
    'cxx',
    'hpp',
    'cs',
    'go',
    'rs',
    'swift',
    'kt',
    'kts',
    'scala',
    'clj',
    'hs',
    'erl',
    'ex',
    'exs',
    'dart',
    'lua',
    'pl',
    'pm',
    'r',
    'jl',
    'fs',
    'fsi',
    'ml',
    'mli',
    'graphql',
    'gql',
    'toml',
    'yaml',
    'yml',
    'ini',
    'cfg',
    'conf',
    'prisma',
    'proto',
    'sol',
    'vim',
    'dockerfile',
    'gradle',
    'cmake',
    'makefile',
    'sh',
    'bash',
    'zsh',
    'fish',
    'ps1',
    'bat',
    'cmd',
  ]);
  if (
    codeLike.has(ext) ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('x-python') ||
    mime.includes('x-sh') ||
    mime.includes('html') ||
    mime.includes('css')
  ) {
    return 'code';
  }

  return 'generic';
}

export function buildFileTypeIcons(safe: (svg: string) => SafeHtml): Record<FileIconKind, SafeHtml> {
  const brand = (key: keyof typeof BRAND_FILE_TYPE_SVGS) => safe(BRAND_FILE_TYPE_SVGS[key]);

  return {
    link: brand('link'),
    pdf: brand('pdf'),
    word: brand('word'),
    slides: brand('presentation'),
    spreadsheet: brand('spreadsheet'),
    image: brand('image'),
    video: brand('video'),
    audio: brand('audio'),
    archive: brand('archive'),
    text: brand('text'),
    markdown: brand('text'),
    json: brand('text'),
    xml: brand('text'),
    generic: brand('unknown'),
    font: brand('unknown'),
    vector: brand('unknown'),
    database: brand('unknown'),
    executable: brand('unknown'),
    code: safe(
      stroked(
        '<path d="M5.5 5 3 8l2.5 3"/><path d="M10.5 5 13 8l-2.5 3"/><path d="M9.2 4.5 6.8 11.5"/>',
      ),
    ),
  };
}
