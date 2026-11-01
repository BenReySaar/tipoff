// Pulls the youth schedule from the Israel Basketball Association site (WordPress + SportsPress REST API)
// and turns it into the compact "pack" the app reads.

import { readXlsx } from './xlsx.js';

const SITE = 'https://ibasketball.co.il';
const BASE = SITE + '/wp-json/sportspress/v2';
const YOUTH = /ילד|נער|נוער|קט/;

// Age groups, youngest first. id, display name, gender, league-name prefix used by the association.
export const AGES = [
  ['ks-b', 'קט-סל ב׳', 'M', 'קט סל ב'], ['ks-a', 'קט-סל א׳', 'M', 'קט סל א'], ['yb', 'ילדים ב׳', 'M', 'ילדים ב'],
  ['ya', 'ילדים א׳', 'M', 'ילדים א'], ['nb', 'נערים ב׳', 'M', 'נערים ב'], ['na', 'נערים א׳', 'M', 'נערים א'], ['nr', 'נוער', 'M', 'נוער'],
  ['gks-b', 'קט-סל ב׳', 'F', 'קט סל ב בנות'], ['gks-a', 'קט-סל א׳', 'F', 'קט סל א בנות'], ['gyb', 'ילדות ב׳', 'F', 'ילדות ב'],
  ['gya', 'ילדות א׳', 'F', 'ילדות א'], ['gnb', 'נערות ב׳', 'F', 'נערות ב'], ['gna', 'נערות א׳', 'F', 'נערות א'],
];

/** Returns [ageId, isCup, shortName] for a league name, or null if it is not a youth league we show. */
export function classify(name) {
  const cup = name.match(/^גביע (?:המדינה|האיגוד) ל(.+)$/);
  if (cup) {
    const a = AGES.find(x => x[3] === cup[1].trim());
    return a ? [a[0], true, name] : null;
  }
  const byLen = [...AGES].sort((x, y) => y[3].length - x[3].length);
  for (const [id, , , p] of byLen) {
    if (!name.startsWith(p + ' ')) continue;
    // "קט סל א בנות ..." must not fall into the boys' "קט סל א" group
    if (p.startsWith('קט סל') && !p.includes('בנות') && (' ' + name + ' ').includes(' בנות ')) continue;
    return [id, false, name.slice(p.length + 1).trim()];
  }
  return null;
}

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

async function getJSON(url, ua) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': ua } });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !type.includes('json')) {
    const err = new Error(`HTTP ${r.status} (${type.split(';')[0] || 'no type'}) for ${url.replace(BASE, '')}`);
    err.status = r.status;
    throw err;
  }
  return { body: await r.json(), pages: +(r.headers.get('X-WP-TotalPages') || 1) };
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

/**
 * Fetches one season (default "2026" = 2026/27) and returns RAW:
 * { leagues:[[id,name,slug]], events:[[id,date,leagueId,homeId,awayId,homeName,awayName,venueId,hs,as]], venues:[[id,name]] }
 */
export async function fetchSeason({ season = '2026', userAgent = 'TipOff/1.0' } = {}) {
  const { body: parents } = await getJSON(`${BASE}/leagues?slug=${season}&_fields=id,name`, userAgent);
  if (!parents.length) throw new Error('season not found: ' + season);
  const parent = parents[0].id;

  let leagues = [], page = 1, pages = 1;
  do {
    const r = await getJSON(`${BASE}/leagues?parent=${parent}&per_page=100&page=${page}&_fields=id,name,slug,count`, userAgent);
    leagues = leagues.concat(r.body); pages = r.pages; page++;
  } while (page <= pages);
  leagues = leagues.filter(l => YOUTH.test(decodeEntities(l.name)) && classify(decodeEntities(l.name)));
  const lgSet = new Set(leagues.map(l => l.id));

  // Events: ask for 20 leagues at a time, then page through.
  const fields = 'id,date,leagues,venues,home,away,main_results,state,teams';
  const groups = [];
  for (let i = 0; i < leagues.length; i += 20) groups.push(leagues.slice(i, i + 20).map(l => l.id).join(','));
  const events = [];
  await pool(groups, 4, async ids => {
    let p = 1, ps = 1;
    do {
      const r = await getJSON(`${BASE}/events?leagues=${ids}&per_page=100&page=${p}&_fields=${fields}`, userAgent);
      for (const e of r.body) {
        if (!Array.isArray(e.teams) || e.teams.length !== 2) continue;
        const lg = (e.leagues || []).find(x => lgSet.has(x));
        if (lg == null) continue;
        const done = e.state === 'finished' && Array.isArray(e.main_results) && e.main_results.length === 2 && e.main_results.every(x => x !== '' && x != null);
        events.push([e.id, e.date, lg, e.teams[0], e.teams[1], decodeEntities(e.home?.team), decodeEntities(e.away?.team),
          (e.venues || [])[0] ?? null, done ? +e.main_results[0] : null, done ? +e.main_results[1] : null]);
      }
      ps = r.pages; p++;
    } while (p <= ps);
  });

  const vIds = [...new Set(events.map(e => e[7]).filter(v => v != null))];
  const venues = [];
  const vGroups = []; for (let i = 0; i < vIds.length; i += 100) vGroups.push(vIds.slice(i, i + 100));
  await pool(vGroups, 4, async ids => {
    const r = await getJSON(`${BASE}/venues?include=${ids.join(',')}&per_page=100&_fields=id,name`, userAgent);
    for (const v of r.body) venues.push([v.id, decodeEntities(v.name)]);
  });

  return { leagues: leagues.map(l => [l.id, decodeEntities(l.name), l.slug]), events, venues };
}

/**
 * The association's REST API only returns games from the last few days onward, but each league's
 * "יצוא לאקסל" file has the whole season with results. HIST rows:
 * [leagueId, code, 'YYYY-MM-DDTHH:MM', home, away, venue, homeScore|null, awayScore|null]
 */
export async function fetchHistory(leagueIds, { userAgent = 'TipOff/1.0' } = {}) {
  const hist = [], failed = [];
  await pool(leagueIds, 6, async id => {
    try {
      const r = await fetch(`${SITE}/?feed=xlsx&league_id=${id}`, { headers: { 'User-Agent': userAgent } });
      if (!r.ok || !/sheet|octet|zip/.test(r.headers.get('content-type') || '')) throw new Error('HTTP ' + r.status);
      hist.push(...histRows(id, await readXlsx(await r.arrayBuffer())));
    } catch (e) { failed.push(id); }
  });
  return { hist, failed };
}
export function histRows(leagueId, rows) {
  const head = rows[0] || [];
  const col = (...names) => head.findIndex(h => names.includes(String(h || '').trim()));
  const C = { code: col('Code'), date: col('תאריך', 'Date'), time: col('Time', 'שעה'), home: col('Home Team'), away: col('Away Team'),
    venue: col('Venue', 'אולם'), hs: col('Home Score'), as: col('Away Score') };
  if (C.date < 0 || C.home < 0 || C.away < 0) return [];
  const out = [];
  for (const r of rows.slice(1)) {
    const m = String(r[C.date] || '').match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/);
    const t = String(r[C.time] || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m || !r[C.home] || !r[C.away]) continue;
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${t ? t[1].padStart(2, '0') + ':' + t[2] : '00:00'}`;
    const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
    const hs = num(r[C.hs]), as = num(r[C.as]);
    out.push([leagueId, +r[C.code] || 0, iso, String(r[C.home]).trim(), String(r[C.away]).trim(), String(r[C.venue] ?? '').trim(),
      hs != null && as != null ? hs : null, hs != null && as != null ? as : null]);
  }
  return out;
}
// Team names differ slightly between the two sources ("מכבי תל אביב-שוהם" / "מכבי תל אביב/שוהם").
export const normName = s => String(s).replace(/[-–־/\\]/g, '/').replace(/["״׳'`]/g, '').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

/**
 * RAW -> pack the app reads:
 * { gen, ages:[[id,name,g]], lg:[[full,slug,age,cup,short]], tm:[[name,lgIdx]], vn:[name], g:[[id,yymmddhhmm,lg,h,a,v,hs?,as?]] }
 */
export function buildPack(raw, gen = new Date().toISOString()) {
  const lgRows = [], lgIdx = new Map();
  for (const [id, name, slug] of raw.leagues) {
    const c = classify(name); if (!c) continue;
    lgIdx.set(id, lgRows.length);
    lgRows.push([name, String(slug).replace(/^\d{4}-/, ''), c[0], c[1] ? 1 : 0, c[2]]);
  }
  const venues = raw.venues.slice();
  const ageOfLg = id => lgRows[lgIdx.get(id)][2];
  const evs = mergeHistory(raw.events.filter(e => lgIdx.has(e[2])), (raw.hist || []).filter(h => lgIdx.has(h[0])), venues, gen, ageOfLg).sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : a[0] - b[0]));
  const vnIdx = new Map(), vn = [];
  for (const [id, name] of venues) { vnIdx.set(id, vn.length); vn.push(name); }
  const unknownVenue = () => { if (!vnIdx.has(null)) { vnIdx.set(null, vn.length); vn.push('אולם לא ידוע'); } return vnIdx.get(null); };

  // team id -> name, and the regular (non-cup) league it plays most in
  const tName = new Map(), tCount = new Map();
  for (const e of evs) {
    const L = lgIdx.get(e[2]);
    for (const [tid, nm] of [[e[3], e[5]], [e[4], e[6]]]) {
      if (!tName.has(tid)) tName.set(tid, nm);
      if (!tCount.has(tid)) tCount.set(tid, new Map());
      const m = tCount.get(tid); const w = lgRows[L][3] ? 0.001 : 1; // cups only decide when nothing else exists
      m.set(L, (m.get(L) || 0) + w);
    }
  }
  const tm = [], tIdx = new Map();
  for (const [tid, nm] of tName) {
    const out = typeof tid === 'string' ? null : tid; // teams known only from the Excel file have no association id
    const best = [...tCount.get(tid)].sort((a, b) => b[1] - a[1])[0][0];
    tIdx.set(tid, tm.length); tm.push(out ? [nm, best, out] : [nm, best]);
  }
  const g = evs.map(e => {
    const d = e[1].replace(/[-T:]/g, '').slice(2, 12);
    const row = [e[0], d, lgIdx.get(e[2]), tIdx.get(e[3]), tIdx.get(e[4]), e[7] != null && vnIdx.has(e[7]) ? vnIdx.get(e[7]) : unknownVenue()];
    if (e[8] != null && e[9] != null) row.push(e[8], e[9]);
    return row;
  });
  return { v: 2, gen, ages: AGES.map(([id, n, gg]) => [id, n, gg]), lg: lgRows, tm, vn, g };
}

/**
 * Adds the games that only the Excel files still have (played games the REST API no longer returns),
 * and fills in results the REST API has not shown yet. Future games come from the REST API only.
 */
function mergeHistory(events, hist, venues, gen, ageOfLg) {
  if (!hist.length) return events;
  events = events.map(e => e.slice());
  const nowIso = new Date(gen).toLocaleString('sv-SE', { timeZone: 'Asia/Jerusalem' }).slice(0, 16).replace(' ', 'T');
  const key = (lg, iso, h, a) => `${lg}|${iso.slice(0, 16)}|${normName(h)}|${normName(a)}`;
  const byKey = new Map(), names = new Map(), byAge = new Map();
  for (const e of events) {
    byKey.set(key(e[2], e[1], e[5], e[6]), e);
    for (const [tid, nm] of [[e[3], e[5]], [e[4], e[6]]]) {
      names.set(e[2] + '|' + normName(nm), [tid, nm]);
      const k = ageOfLg(e[2]) + '|' + normName(nm);
      if (!byAge.has(k)) byAge.set(k, new Map());
      byAge.get(k).set(tid, nm);
    }
  }
  // same league first; otherwise (e.g. a cup game of a team that is out of the cup) the one team with that name in the same age group
  const team = (lg, nm) => {
    const hit = names.get(lg + '|' + normName(nm)); if (hit) return hit;
    const same = byAge.get(ageOfLg(lg) + '|' + normName(nm));
    if (same && same.size === 1) return [...same][0];
    const id = 'x:' + ageOfLg(lg) + ':' + normName(nm);
    names.set(lg + '|' + normName(nm), [id, nm]);
    return [id, nm];
  };
  // same game seen again under a slightly different time: match by league + day + teams
  const byDay = new Map(events.map(e => [`${e[2]}|${e[1].slice(0, 10)}|${normName(e[5])}|${normName(e[6])}`, e]));
  const vByName = new Map(venues.map(([id, n]) => [normName(n), id]));
  const out = events.slice();
  for (const [lg, code, iso, home, away, venue, hs, as] of hist) {
    const e = byKey.get(key(lg, iso, home, away)) || byDay.get(`${lg}|${iso.slice(0, 10)}|${normName(home)}|${normName(away)}`);
    if (e) { if (e[8] == null && hs != null && iso < nowIso) { e[8] = hs; e[9] = as; } continue; }
    if (iso >= nowIso) continue; // upcoming games: the REST API is the source of truth
    const [hid, hn] = team(lg, home), [aid, an] = team(lg, away);
    let vid = vByName.get(normName(venue));
    if (vid == null && venue) { vid = 'xv:' + normName(venue); vByName.set(normName(venue), vid); venues.push([vid, venue]); }
    out.push([-(code || Math.abs(hashCode(lg + iso + home + away))), iso + ':00', lg, hid, aid, hn, an, vid ?? null, hs, as]);
  }
  return out;
}
const hashCode = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h || 1; };

const teamKey = (pack, ti) => pack.lg[pack.tm[ti][1]][1] + '|' + pack.tm[ti][0];
const fmtWhen = d => `${+d.slice(4, 6)}.${+d.slice(2, 4)} ${d.slice(6, 8)}:${d.slice(8, 10)}`;

/** A readable description of one game in a pack. */
export function gameInfo(pack, row) {
  const [id, d, lg, h, a, v, hs, as] = row;
  return {
    id, d, when: fmtWhen(d), league: pack.lg[lg][0], leagueSlug: pack.lg[lg][1],
    home: pack.tm[h][0], away: pack.tm[a][0], homeKey: teamKey(pack, h), awayKey: teamKey(pack, a),
    venue: pack.vn[v], hs: hs ?? null, as: as ?? null,
  };
}

/**
 * Compares two packs. Returns { changes, guard } where changes are
 * { kind: 'moved'|'venue'|'moved+venue'|'removed'|'result', game, before }.
 * guard is a reason string when the new pack looks broken (then nothing should be stored or sent).
 */
export function diffPacks(prev, next, now = new Date()) {
  if (!prev) return { changes: [], guard: null };
  if (next.g.length < prev.g.length * 0.6) return { changes: [], guard: `only ${next.g.length} games vs ${prev.g.length} before` };
  const before = new Map(prev.g.map(r => [r[0], r]));
  const after = new Map(next.g.map(r => [r[0], r]));
  const nowKey = ymd(now);
  const changes = [];
  for (const [id, r] of after) {
    const p = before.get(id); if (!p) continue;
    const A = gameInfo(next, r), B = gameInfo(prev, p);
    if (A.d < nowKey && B.d < nowKey) { // game already in the past: only results matter
      if (A.hs != null && B.hs == null) changes.push({ kind: 'result', game: A, before: B });
      continue;
    }
    const moved = A.d !== B.d, venue = A.venue !== B.venue;
    if (moved || venue) changes.push({ kind: moved && venue ? 'moved+venue' : moved ? 'moved' : 'venue', game: A, before: B });
    else if (A.hs != null && B.hs == null) changes.push({ kind: 'result', game: A, before: B });
  }
  for (const [id, p] of before) {
    if (after.has(id)) continue;
    const B = gameInfo(prev, p);
    if (B.d >= nowKey) changes.push({ kind: 'removed', game: B, before: B });
  }
  return { changes, guard: null };
}

/** "yymmddhhmm" for a Date, in Israel time. */
export function ymd(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(x => [x.type, x.value]));
  return p.year + p.month + p.day + p.hour + p.minute;
}

/** Keeps the last 7 days of changes on the pack so the app can mark moved games. */
export function attachChangeLog(pack, prevLog, changes, now = Date.now()) {
  const log = (prevLog || []).filter(c => now - c[0] < 7 * 864e5);
  for (const c of changes) {
    if (c.kind === 'result') continue;
    log.push([now, c.game.id, c.kind, c.before.d, c.before.venue]);
  }
  pack.ch = log;
  return pack;
}
