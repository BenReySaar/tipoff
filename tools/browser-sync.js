// Plan B — use only if the server's hourly sync is blocked by the association site.
// 1. Open https://ibasketball.co.il in Chrome.  2. Open the console (F12 → Console).
// 3. Change the two lines below, paste the whole file, press Enter. It takes about a minute.
const TIPOFF = 'https://FILL-your-domain';
const ADMIN_KEY = 'FILL-your-admin-key';

(async () => {
  const B = '/wp-json/sportspress/v2', SEASON = '2026';
  const j = async u => { const r = await fetch(B + u); if (!r.ok) throw new Error(r.status + ' ' + u); return { body: await r.json(), pages: +(r.headers.get('X-WP-TotalPages') || 1) }; };
  const parent = (await j(`/leagues?slug=${SEASON}&_fields=id`)).body[0].id;
  let L = [], p = 1, ps = 1;
  do { const r = await j(`/leagues?parent=${parent}&per_page=100&page=${p}&_fields=id,name,slug`); L = L.concat(r.body); ps = r.pages; p++; } while (p <= ps);
  const ta = document.createElement('textarea'), dec = s => { ta.innerHTML = s ?? ''; return ta.value; };
  L = L.filter(l => /ילד|נער|נוער|קט/.test(dec(l.name)));
  const set = new Set(L.map(l => l.id)), events = [];
  for (let i = 0; i < L.length; i += 20) {
    const ids = L.slice(i, i + 20).map(l => l.id).join(','); let q = 1, qs = 1;
    do {
      const r = await j(`/events?leagues=${ids}&per_page=100&page=${q}&_fields=id,date,leagues,venues,home,away,main_results,state,teams`);
      for (const e of r.body) {
        if (!Array.isArray(e.teams) || e.teams.length !== 2) continue;
        const lg = (e.leagues || []).find(x => set.has(x)); if (lg == null) continue;
        const done = e.state === 'finished' && e.main_results?.length === 2 && e.main_results.every(x => x !== '' && x != null);
        events.push([e.id, e.date, lg, e.teams[0], e.teams[1], dec(e.home?.team), dec(e.away?.team), (e.venues || [])[0] ?? null, done ? +e.main_results[0] : null, done ? +e.main_results[1] : null]);
      }
      qs = r.pages; q++; console.log('games so far:', events.length);
    } while (q <= qs);
  }
  const vids = [...new Set(events.map(e => e[7]).filter(v => v != null))], venues = [];
  for (let i = 0; i < vids.length; i += 100) for (const v of (await j(`/venues?include=${vids.slice(i, i + 100).join(',')}&per_page=100&_fields=id,name`)).body) venues.push([v.id, dec(v.name)]);
  const raw = { leagues: L.map(l => [l.id, dec(l.name), l.slug]), events, venues };
  const r = await fetch(`${TIPOFF}/api/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': ADMIN_KEY }, body: JSON.stringify(raw) });
  console.log('טיפ-אוף:', await r.json());
})();
