// Builds a RAW object (the same shape fetchSeason returns) from the pack we pulled through the browser on 28.10.2026.
import fs from 'node:fs';
export function rawFromV1(path = new URL('./sample-pack-v1.json', import.meta.url)) {
  const P = JSON.parse(fs.readFileSync(path, 'utf8'));
  const leagues = P.lg.map(([name, slug], i) => [1000 + i, name, '2026-' + slug]);
  const venues = P.vn.map((n, i) => [5000 + i, n]);
  const events = P.g.map((g, i) => {
    const [d, lg, h, a, v, hs, as] = g;
    const date = `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)}T${d.slice(6, 8)}:${d.slice(8, 10)}:00`;
    return [100000 + i, date, 1000 + lg, 20000 + h, 20000 + a, P.tm[h][0], P.tm[a][0], 5000 + v, hs ?? null, as ?? null];
  });
  return { leagues, events, venues };
}
