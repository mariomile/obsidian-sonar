import type { DocType } from '../index/fields.ts';

const BY_EXT: Record<string, string> = {
  pdf: 'file-type',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  bmp: 'image',
  tiff: 'image',
  svg: 'image',
  html: 'globe',
  htm: 'globe',
  canvas: 'layout-dashboard',
  base: 'database',
  zip: 'file-archive',
  gz: 'file-archive',
  tar: 'file-archive',
  rar: 'file-archive',
  mp4: 'film',
  mov: 'film',
  webm: 'film',
  mkv: 'film',
  mp3: 'music',
  wav: 'music',
  m4a: 'music',
  flac: 'music',
  json: 'braces',
  csv: 'table',
  xlsx: 'table',
};

const BY_DOCTYPE: Record<DocType, string> = {
  md: 'file-text',
  pdf: 'file-type',
  image: 'image',
  html: 'globe',
};

/** Pick an Obsidian icon: extension first, then docType, then a generic file. */
export function iconFor(ext: string | undefined, docType: DocType): string {
  if (ext && BY_EXT[ext]) return BY_EXT[ext]!;
  if (docType && BY_DOCTYPE[docType]) return BY_DOCTYPE[docType]!;
  return 'file';
}
