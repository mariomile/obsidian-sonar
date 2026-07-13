import type { ModeSigil } from './types.ts';

const SIGILS: ModeSigil[] = ['>', '+', '?'];

/** Split a raw input into its mode sigil (first char, if one) and the remaining
 *  query with leading whitespace trimmed. Plain text is search mode (''). */
export function parseSigil(raw: string): { sigil: ModeSigil; stripped: string } {
  const first = raw[0] as ModeSigil | undefined;
  if (first && SIGILS.includes(first)) {
    return { sigil: first, stripped: raw.slice(1).replace(/^\s+/, '') };
  }
  return { sigil: '', stripped: raw };
}
