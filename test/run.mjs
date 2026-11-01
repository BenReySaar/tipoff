import assert from 'node:assert/strict';
import { buildPack, diffPacks, classify, attachChangeLog } from '../src/ibba.js';
import { rawFromV1 } from './make-raw.mjs';

const raw = rawFromV1();
const pack = buildPack(raw, '2026-10-28T12:38:00Z');
console.log('pack:', pack.lg.length, 'leagues', pack.tm.length, 'teams', pack.g.length, 'games', JSON.stringify(pack).length, 'bytes');
assert.equal(pack.g.length, 15463);
assert.equal(pack.lg.length, 240);
assert.deepEqual(classify('קט סל א בנות עמק חפר').slice(0, 1), ['gks-a']);
assert.deepEqual(classify('קט סל א עמק חפר').slice(0, 1), ['ks-a']);
assert.deepEqual(classify('גביע המדינה לנערות ב').slice(0, 2), ['gnb', true]);
assert.equal(classify('ליגת על'), null);

// change detection
const now = new Date('2026-10-28T13:00:00Z');
const raw2 = structuredClone(raw);
const future = raw2.events.filter(e => e[1] > '2026-11-01').slice(0, 4);
future[0][1] = future[0][1].replace(/T\d\d:\d\d/, 'T18:30');           // moved
future[1][7] = raw2.venues[3][0];                                        // new hall
raw2.events = raw2.events.filter(e => e !== future[2]);                  // cancelled
const pastNoScore = raw2.events.find(e => e[1] < '2026-10-28' && e[8] == null);
pastNoScore[8] = 70; pastNoScore[9] = 61;                                // result came in
const pack2 = buildPack(raw2);
const { changes, guard } = diffPacks(pack, pack2, now);
console.log('changes:', changes.map(c => c.kind + ' ' + c.game.home + ' - ' + c.game.away + ' ' + c.before.when + ' → ' + c.game.when));
assert.equal(guard, null);
assert.deepEqual(changes.map(c => c.kind).sort(), ['moved', 'removed', 'result', 'venue'].sort());

// broken fetch guard
const half = buildPack({ ...raw, events: raw.events.slice(0, 5000) });
assert.ok(diffPacks(pack, half, now).guard);

attachChangeLog(pack2, [], changes, now.getTime());
assert.equal(pack2.ch.length, 3);
console.log('ibba: ok');

// ---- season history from the association's Excel export (REST only returns recent + upcoming games) ----
{
  const fs = await import('node:fs');
  const { readXlsx } = await import('../src/xlsx.js');
  const { histRows } = await import('../src/ibba.js');
  const rows = await readXlsx(fs.readFileSync(new URL('./fixtures/league-119995.xlsx', import.meta.url)));
  const hist = histRows(119995, rows);
  // (a few rows in this sample have empty date cells; rows without a date are skipped)
  assert.equal(hist.length, rows.slice(1).filter(r => /^\d{1,2}-\d{1,2}-\d{4}$/.test(String(r[3])) && r[6] && r[8]).length);
  assert.ok(hist.length >= 99);
  assert.deepEqual(hist[0].slice(0, 3), [119995, 807161, '2026-10-15T19:00']);
  // REST view on 1.11: only games from 29.10 on, team names with "/" and its own ids
  const ids = new Map(); const tid = n => { const k = n.replace('-', '/'); if (!ids.has(k)) ids.set(k, 5000 + ids.size); return ids.get(k); };
  const restGames = hist.filter(h => h[2] >= '2026-10-29');
  const events = restGames.map((h, i) => [900 + i, h[2] + ':00', 119995, tid(h[3]), tid(h[4]), h[3].replace('-', '/'), h[4].replace('-', '/'), 1, h[2] < '2026-11-01' && h[6] != null ? h[6] : null, h[2] < '2026-11-01' && h[6] != null ? h[7] : null]);
  const raw = { leagues: [[119995, 'ילדים א בקעת אונו', '2026-271']], events, venues: [[1, 'אולם']] };
  const before = buildPack(raw, '2026-11-01T16:00:00Z');
  const after = buildPack({ ...raw, hist }, '2026-11-01T16:00:00Z');
  console.log('history: REST only', before.g.length, 'games → with Excel', after.g.length, '| teams', before.tm.length, '→', after.tm.length);
  assert.equal(after.g.length, hist.length, 'all season games present, no duplicates');
  assert.equal(after.tm.length, before.tm.length, 'no duplicate teams from name differences');
  const first = after.g.find(g => g[0] === -807161);
  assert.ok(first, 'game from 15.10 is back'); assert.equal(first[1], '2610151900'); assert.equal(first[6], 37); assert.equal(first[7], 35);
  assert.equal(after.tm[first[3]][0], 'עירוני ק. אונו עתיד');
  assert.ok(after.g.filter(g => g[1] < '2610290000').every(g => g[6] != null), 'old games have results');
  assert.ok(after.g.filter(g => g[1] >= '2611020000').every(g => g[0] >= 900), 'upcoming games come from REST only');
  console.log('history: ok');
}
