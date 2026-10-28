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
