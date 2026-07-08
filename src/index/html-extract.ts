const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body[0] === '#') {
      const cp =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

/**
 * Turn raw HTML into plain text for indexing. Removes script/style blocks and
 * all tags, decodes entities, collapses whitespace. Pure string processing —
 * no DOM, so it runs headless and adds no dependency.
 */
export function htmlToText(raw: string): { title: string | null; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw);
  const title = titleMatch ? decodeEntities(titleMatch[1]!).trim() || null : null;

  const stripped = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
  return { title, text };
}
