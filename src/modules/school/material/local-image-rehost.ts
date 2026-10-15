/**
 * Pictures in a saved material whose address only works on the computer that
 * made it.
 *
 * A deck generated through a local AI service records each painted slide as
 * http://localhost:8001/generated-note-images/…. A local run saves into the
 * shared database, so the deck appears on the deployed site — where every
 * other browser looks for that picture on its own computer and shows a broken
 * image (13 decks on dev, 6–12 Oct 2026). Before such a material is saved,
 * each of those pictures is fetched (the saving backend can reach it: it runs
 * on the same computer) and stored with a public address instead.
 *
 * Addresses appear both in the visible Markdown and inside the deck
 * specification a V2 deck embeds as base64 (`<!-- EDDVA_PPT_V2_DECK:… -->`,
 * see public/ppt-studio/js/v2Deck.js), so both are rewritten.
 */

/** http(s)://localhost | 127.0.0.1 | 0.0.0.0 | [::1] (any port) followed by a path. */
const LOCAL_URL = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?\/[^\s"'<>)\\]+/gi;
const DECK = /<!--\s*EDDVA_PPT_V2_DECK:([A-Za-z0-9+/=]+)\s*-->/;

function decodeDeck(description: string): string | null {
  const m = description.match(DECK);
  if (!m) return null;
  try {
    return Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/** Every local-only address in the material: Markdown and embedded deck. */
export function findLocalImageUrls(description: string | null | undefined): string[] {
  if (!description) return [];
  const found = new Set<string>(description.match(LOCAL_URL) || []);
  const deck = decodeDeck(description);
  for (const u of deck?.match(LOCAL_URL) || []) found.add(u);
  return [...found];
}

/** The material with each address in ``map`` replaced, deck re-encoded. */
export function replaceImageUrls(description: string, map: Record<string, string>): string {
  const swap = (s: string) => s.replace(LOCAL_URL, (u) => map[u] ?? u);
  const deck = decodeDeck(description);
  let out = description;
  if (deck !== null) {
    out = out.replace(DECK, `<!-- EDDVA_PPT_V2_DECK:${Buffer.from(swap(deck), 'utf8').toString('base64')} -->`);
  }
  return swap(out);
}

/**
 * ``description`` with every local-only picture stored publicly by ``store``.
 *
 * ``store(url)`` returns the public address, or null when the picture could
 * not be fetched — that address is then kept, so saving never fails here.
 */
export async function rehostLocalImages(
  description: string | null | undefined,
  store: (url: string) => Promise<string | null>,
): Promise<{ description: string | null | undefined; moved: number; failed: string[] }> {
  const urls = findLocalImageUrls(description);
  if (!urls.length || !description) return { description, moved: 0, failed: [] };
  const map: Record<string, string> = {};
  const failed: string[] = [];
  for (const url of urls) {
    let stored: string | null = null;
    try {
      stored = await store(url);
    } catch {
      stored = null;
    }
    if (stored) map[url] = stored;
    else failed.push(url);
  }
  return {
    description: Object.keys(map).length ? replaceImageUrls(description, map) : description,
    moved: Object.keys(map).length,
    failed,
  };
}
