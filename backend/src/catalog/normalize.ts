/** Texte comparable : minuscules, sans accents ni apostrophes typographiques, espaces réduits. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pertinence d'un texte pour une recherche (0 = aucun rapport). Chaque mot de la recherche doit apparaître
 * au début d'un mot du texte (« plomb » trouve « Plomberie », « clim » trouve « climatiseur »).
 */
export function matchScore(query: string, text: string): number {
  const q = normalize(query);
  const t = normalize(text);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  const words = t.split(' ');
  const parts = q.split(' ');
  if (parts.every((p) => words.some((w) => w.startsWith(p)))) return 60;
  return 0;
}
