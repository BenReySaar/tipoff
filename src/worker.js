// טיפ-אוף server: serves the app, syncs the schedule every hour, sends push notifications,
// serves each family's calendar feed, and counts usage.
import { fetchSeason, fetchHistory, buildPack, diffPacks, attachChangeLog, ymd } from './ibba.js';
import { sendPush } from './push.js';
import { icsFor } from './ics.js';
import { statsPage } from './stats.js';
import { ensureSchema } from './schema.js';
import { b64u } from './push.js';
import { occOn } from './practice.js';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DEVICE = /^[a-f0-9-]{36}$/;
const TEAM = /^[^|]{1,12}\|.{1,80}$/;

const ilDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const ilHour = (d = new Date()) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(d);
const quietNow = (d = new Date()) => { const h = ilHour(d); return h >= 23 || h < 8; }; // no notifications 23:00–08:00
// Local testing only (DEV_ALLOW_HTTP_PUSH=1 exists only in .dev.vars): pretend it is night or day.
async function isQuiet(env) {
  if (env.DEV_ALLOW_HTTP_PUSH === '1') { const f = await env.KV.get('dev:quiet'); if (f != null) return f === '1'; }
  return quietNow();
}
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

// Push signing keys: taken from settings if given, otherwise created once by the server and kept in KV.
let vapidCache = null;
async function vapidOf(env) {
  const subject = env.VAPID_SUBJECT || 'https://github.com/BenReySaar/tipoff';
  if (env.VAPID_PUBLIC && env.VAPID_PRIVATE_JWK) return { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject };
  if (vapidCache) return { ...vapidCache, subject };
  let stored = JSON.parse(await env.KV.get('vapid') || 'null');
  if (!stored) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const { key_ops, ext, ...privateJwk } = await crypto.subtle.exportKey('jwk', kp.privateKey);
    stored = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateJwk };
    await env.KV.put('vapid', JSON.stringify(stored));
  }
  vapidCache = stored;
  return { ...stored, subject };
}
async function getPack(env) { const t = await env.KV.get('pack'); return t ? JSON.parse(t) : null; }
async function track(env, device, type) {
  await env.DB.prepare('INSERT INTO activity(day,device,type,n) VALUES(?,?,?,1) ON CONFLICT(day,device,type) DO UPDATE SET n=n+1')
    .bind(ilDay(), device, type).run();
}
async function logPush(env, kind, sent, failed) {
  if (!sent && !failed) return;
  await env.DB.prepare('INSERT INTO pushlog(day,kind,sent,failed) VALUES(?,?,?,?) ON CONFLICT(day,kind) DO UPDATE SET sent=sent+excluded.sent, failed=failed+excluded.failed')
    .bind(ilDay(), kind, sent, failed).run();
}
const keyAllowed = (env, url, req) => !!env.ADMIN_KEY && (url.searchParams.get('key') === env.ADMIN_KEY || req?.headers.get('x-admin-key') === env.ADMIN_KEY);

/* ---------------- sync ---------------- */

export async function runSync(env, { raw = null, source = 'cron' } = {}) {
  const started = Date.now();
  const status = { at: started, source };
  try {
    const prev = await getPack(env);
    const userAgent = `Mozilla/5.0 (compatible; TipOff/1.0; +${env.APP_URL || 'https://tipoff'})`;
    raw = raw || await fetchSeason({ season: env.SEASON || '2026', userAgent });
    // whole-season history (the REST API only returns the last few days onward): refreshed every 6 hours
    let hist = JSON.parse(await env.KV.get('hist') || 'null');
    const tried = +(await env.KV.get('hist:tried') || 0);
    if (((!hist || Date.now() - hist.at > 6 * 3600e3) && Date.now() - tried > 6 * 3600e3) || source === 'manual' || source === 'history') {
      await env.KV.put('hist:tried', String(Date.now())); // at most every 6 hours, also when it fails
      try {
        const ids = raw.leagues.map(l => l[0]);
        const got = await fetchHistory(ids, { userAgent });
        if (got.hist.length) {
          const failed = new Set(got.failed);
          const keep = (hist?.rows || []).filter(r => failed.has(r[0])); // leagues that failed this time keep their last rows
          hist = { at: Date.now(), rows: got.hist.concat(keep), leagues: ids.length - got.failed.length, failed: got.failed.length };
          await env.KV.put('hist', JSON.stringify(hist));
        } else if (hist) hist.error = 'קבצי האקסל לא נטענו (' + got.failed.length + ' ליגות)';
        else status.histError = 'קבצי האקסל של האיגוד לא נטענו';
      } catch (e) { status.histError = 'קבצי האקסל: ' + String(e && e.message || e); }
    }
    raw = { ...raw, hist: hist?.rows || [] };
    if (hist) Object.assign(status, { histAt: hist.at, histRows: hist.rows.length, histLeagues: hist.leagues, histFailed: hist.failed });
    const next = buildPack(raw);
    const { changes, guard } = diffPacks(prev, next);
    if (guard) throw new Error('נעצר כדי לא לשמור נתונים חסרים: ' + guard);
    attachChangeLog(next, prev?.ch, changes, started);
    await env.KV.put('pack', JSON.stringify(next));
    if (changes.length) {
      const stmt = env.DB.prepare('INSERT INTO changes(ts,game,kind,info) VALUES(?,?,?,?)');
      await env.DB.batch(changes.slice(0, 500).map(c => stmt.bind(started, c.game.id, c.kind, JSON.stringify({ before: c.before, after: c.game }))));
    }
    const pushed = prev ? await notifyChanges(env, changes) : 0;
    Object.assign(status, { ok: true, games: next.g.length, leagues: next.lg.length, changes: changes.length, pushed, ms: Date.now() - started });
  } catch (e) {
    const msg = String(e && e.message || e);
    const blocked = e && (e.status === 403 || e.status === 429 || e.status === 503);
    Object.assign(status, { ok: false, ms: Date.now() - started,
      error: msg.startsWith('נעצר') ? msg : (blocked ? 'אתר האיגוד חסם את השרת (' + msg + '). אפשר להשתמש בתוכנית ב׳: tools/browser-sync.js' : 'לא הצלחנו למשוך נתונים מאתר האיגוד: ' + msg) });
  }
  await env.KV.put('sync:status', JSON.stringify(status));
  if (status.ok) await env.KV.put('sync:last-ok', JSON.stringify(status));
  return status;
}

/* ---------------- notifications ---------------- */

const fromD = d => ({ y: 2000 + +d.slice(0, 2), m: +d.slice(2, 4), day: +d.slice(4, 6), hm: d.slice(6, 8) + ':' + d.slice(8, 10) });
const dayName = d => { const x = fromD(d); return DAYS[new Date(Date.UTC(x.y, x.m - 1, x.day)).getUTCDay()]; };
const whenText = d => { const x = fromD(d); return `${dayName(d)} ${x.day}.${x.m} ב־${x.hm}`; };
const hallShort = v => String(v).split(',')[0].trim();

const withNick = (team, nick) => nick ? `${team} (${nick})` : team;
function messageFor(change, teamKey, nick) {
  const g = change.game, b = change.before;
  const mineHome = g.homeKey === teamKey;
  const team = withNick(mineHome ? g.home : g.away, nick), opp = mineHome ? g.away : g.home;
  switch (change.kind) {
    case 'moved': return { title: `⚠️ המשחק זז: ${team}`, body: `נגד ${opp}: עכשיו ${whenText(g.d)} (היה ${whenText(b.d)})` };
    case 'venue': return { title: `📍 החלפת אולם: ${team}`, body: `נגד ${opp}, ${whenText(g.d)}\n${g.venue}` };
    case 'moved+venue': return { title: `⚠️ שינוי במשחק: ${team}`, body: `נגד ${opp}: עכשיו ${whenText(g.d)} (היה ${whenText(b.d)})\n${g.venue}` };
    case 'removed': return { title: `❌ המשחק ירד מהלוח: ${team}`, body: `נגד ${opp}, ${whenText(b.d)}. כדאי לבדוק מול המאמן.` };
    case 'result': {
      const my = mineHome ? g.hs : g.as, op = mineHome ? g.as : g.hs;
      return { title: `🏀 ${team} ${my > op ? 'ניצחה' : 'הפסידה'} ${my}–${op}`, body: `נגד ${opp}` };
    }
  }
}

async function devicesFollowing(env, teamKeys) {
  const rows = [];
  const keys = [...new Set(teamKeys)];
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    const r = await env.DB.prepare(`SELECT f.device, f.team, f.kind, d.push, d.prefs, n.nick FROM follows f JOIN devices d ON d.id=f.device
      LEFT JOIN nicks n ON n.device=f.device AND n.team=f.team
      WHERE d.push IS NOT NULL AND f.team IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    rows.push(...r.results);
  }
  return rows;
}

async function deliver(env, perDevice, kind) {
  const vapid = await vapidOf(env);
  let sent = 0, failed = 0;
  const list = [...perDevice.values()];
  for (let i = 0; i < list.length; i += 20) {
    await Promise.all(list.slice(i, i + 20).map(async ({ device, push, msgs }) => {
      const payload = msgs.length === 1
        ? { ...msgs[0], url: '/', tag: kind }
        : { title: `${msgs.length} עדכונים במשחקים שלכם`, body: msgs.slice(0, 3).map(m => m.title.replace(/^\S+\s/, '')).join('\n'), url: '/', tag: kind };
      const r = await sendPush(JSON.parse(push), payload, vapid);
      if (r.ok) sent++; else failed++;
      if (r.gone) await env.DB.prepare('UPDATE devices SET push=NULL WHERE id=?').bind(device).run();
    }));
  }
  await logPush(env, kind, sent, failed);
  return sent;
}

async function notifyChanges(env, changes) {
  if (!changes.length) return 0;
  const keys = changes.flatMap(c => [c.game.homeKey, c.game.awayKey]);
  const rows = await devicesFollowing(env, keys);
  const per = { change: new Map(), result: new Map() };
  for (const row of rows) {
    const prefs = JSON.parse(row.prefs || '{}');
    for (const c of changes) {
      if (c.game.homeKey !== row.team && c.game.awayKey !== row.team) continue;
      const isResult = c.kind === 'result';
      if (isResult ? !prefs.result : (row.kind !== 'full' || prefs.change === false)) continue;
      const bucket = per[isResult ? 'result' : 'change'];
      if (!bucket.has(row.device)) bucket.set(row.device, { device: row.device, push: row.push, msgs: [], seen: new Set() });
      const b = bucket.get(row.device);
      if (b.seen.has(c.game.id + c.kind)) continue; // two followed teams in the same game
      b.seen.add(c.game.id + c.kind);
      b.msgs.push(messageFor(c, row.team, row.nick));
    }
  }
  if (await isQuiet(env)) return holdForMorning(env, per);
  return (await deliver(env, per.change, 'change')) + (await deliver(env, per.result, 'result'));
}

// Quiet hours: keep the messages and send them together after 08:00.
async function holdForMorning(env, per) {
  const stmt = env.DB.prepare('INSERT INTO pending(device,kind,ts,msg) VALUES(?,?,?,?)');
  const rows = [];
  for (const kind of Object.keys(per)) for (const b of per[kind].values()) for (const m of b.msgs) rows.push(stmt.bind(b.device, kind, Date.now(), JSON.stringify(m)));
  for (let i = 0; i < rows.length; i += 100) await env.DB.batch(rows.slice(i, i + 100));
  return 0;
}
export async function flushPending(env) {
  if (await isQuiet(env)) return 0;
  const { results } = await env.DB.prepare(`SELECT p.rowid id, p.device, p.kind, p.msg, d.push FROM pending p JOIN devices d ON d.id=p.device
    WHERE d.push IS NOT NULL ORDER BY p.ts LIMIT 2000`).all();
  const per = { change: new Map(), result: new Map() };
  for (const r of results) {
    const bucket = per[r.kind === 'result' ? 'result' : 'change'];
    if (!bucket.has(r.device)) bucket.set(r.device, { device: r.device, push: r.push, msgs: [] });
    bucket.get(r.device).msgs.push(JSON.parse(r.msg));
  }
  await env.DB.prepare('DELETE FROM pending WHERE rowid <= ?').bind(results.length ? Math.max(...results.map(r => r.id)) : 0).run();
  await env.DB.prepare('DELETE FROM pending WHERE device NOT IN (SELECT id FROM devices WHERE push IS NOT NULL)').run();
  return (await deliver(env, per.change, 'change')) + (await deliver(env, per.result, 'result'));
}

async function eveningReminders(env) {
  const pack = await getPack(env); if (!pack) return 0;
  const tomorrow = ymd(new Date(Date.now() + 864e5)).slice(0, 6);
  const keyOf = ti => pack.lg[pack.tm[ti][1]][1] + '|' + pack.tm[ti][0];
  const games = pack.g.filter(g => g[1].startsWith(tomorrow));
  if (!games.length) return 0;
  const byKey = new Map();
  for (const g of games) for (const ti of [g[3], g[4]]) { const k = keyOf(ti); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push({ g, ti }); }
  const rows = await devicesFollowing(env, [...byKey.keys()]);
  const per = new Map();
  for (const row of rows) {
    if (row.kind !== 'full') continue;
    const prefs = JSON.parse(row.prefs || '{}'); if (prefs.eve === false) continue;
    for (const { g, ti } of byKey.get(row.team) || []) {
      const home = g[3] === ti, opp = pack.tm[home ? g[4] : g[3]][0];
      if (!per.has(row.device)) per.set(row.device, { device: row.device, push: row.push, msgs: [] });
      per.get(row.device).msgs.push({
        title: `מחר: ${withNick(pack.tm[ti][0], row.nick)} ב־${fromD(g[1]).hm}`,
        body: `נגד ${opp} · ${hallShort(pack.vn[g[5]])}\n👕 ${home ? 'משחק בית' : 'משחק חוץ'} – לבדוק צבע גופייה`,
      });
    }
  }
  for (const p of per.values()) p.msgs.sort((a, b) => a.title.localeCompare(b.title));
  return deliver(env, per, 'eve');
}

/* ---------------- regular practices (entered by the family, kept per phone) ---------------- */

const REMIND = [0, 30, 60, 120, -1]; // minutes before; -1 = the evening before at 20:00; 0 = none
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
export function cleanPractices(list, skips, teams, moves) {
  const out = [];
  for (const p of Array.isArray(list) ? list.slice(0, 40) : []) {
    if (!p || !teams.has(p.team) || !HM.test(p.start || '')) continue;
    const once = DAY.test(p.once || '') ? p.once : '';
    const days = once ? [dowOf(once)] : [...new Set((Array.isArray(p.days) ? p.days : []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    if (!days.length) continue;
    out.push({ id: clean(p.id, 12) || Math.random().toString(36).slice(2, 10), team: p.team, days, start: p.start, ...(once ? { once } : {}),
      end: HM.test(p.end || '') ? p.end : '', place: clean(p.place, 60), note: clean(p.note, 60),
      remind: REMIND.includes(+p.remind) ? +p.remind : 60 });
  }
  const ids = new Set(out.map(p => p.id)), sk = {}, mv = {};
  for (const [id, dates] of Object.entries(skips && typeof skips === 'object' ? skips : {})) {
    if (!ids.has(id) || !Array.isArray(dates)) continue;
    const d = dates.filter(x => DAY.test(x)).sort().slice(-30); if (d.length) sk[id] = d;
  }
  for (const [id, m] of Object.entries(moves && typeof moves === 'object' ? moves : {})) {
    if (!ids.has(id) || !m || typeof m !== 'object') continue;
    const e = Object.entries(m).filter(([o, x]) => DAY.test(o) && x && DAY.test(x.date || '') && HM.test(x.start || '')).sort().slice(-30);
    if (e.length) mv[id] = Object.fromEntries(e.map(([o, x]) => [o, { date: x.date, start: x.start, end: HM.test(x.end || '') ? x.end : '', place: clean(x.place, 60) }]));
  }
  return { list: out, skips: sk, moves: mv };
}
// Israel-time calendar helpers
const ilParts = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(x => [x.type, x.value]));
const addDay = (ymdStr, n) => { const [y, m, d] = ymdStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const dowOf = ymdStr => { const [y, m, d] = ymdStr.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); }; // (same as practice.js)
const remindWord = r => r === -1 ? 'מחר' : r === 30 ? 'בעוד חצי שעה' : r === 120 ? 'בעוד שעתיים' : 'בעוד שעה';

/** Reminders whose time fell in the last 15 minutes (cron every 15 minutes). */
export async function practiceReminders(env, now = new Date()) {
  const P = ilParts(now), today = `${P.year}-${P.month}-${P.day}`, nowMin = +P.hour * 60 + +P.minute;
  const { results } = await env.DB.prepare('SELECT p.device, p.data, d.push FROM practices p JOIN devices d ON d.id=p.device WHERE d.push IS NOT NULL').all();
  const per = new Map();
  for (const row of results) {
    let data; try { data = JSON.parse(row.data); } catch (e) { continue; }
    const nicks = new Map();
    for (const off of [0, 1]) {
      const date = addDay(today, off);
      for (const o of occOn(data, date)) {
        const p = o.p;
        if (!p.remind) continue;
        const [h, m] = o.start.split(':').map(Number);
        const at = p.remind === -1 ? (off - 1) * 1440 + 20 * 60 : off * 1440 + h * 60 + m - p.remind; // minutes from today's midnight
        if (at > nowMin || at <= nowMin - 15) continue;
        const tod = ((at % 1440) + 1440) % 1440; if (tod >= 23 * 60 || tod < 8 * 60) continue; // quiet hours
        const key = `pr:${row.device}:${p.id}:${o.orig}:${date}:${o.start}`;
        if (await env.KV.get(key)) continue;
        await env.KV.put(key, '1', { expirationTtl: 2 * 86400 });
        if (!nicks.size) { const r = await env.DB.prepare('SELECT team, nick FROM nicks WHERE device=?').bind(row.device).all(); r.results.forEach(x => nicks.set(x.team, x.nick)); nicks.set('', ''); }
        const name = p.team.split('|')[1], nick = nicks.get(p.team);
        if (!per.has(row.device)) per.set(row.device, { device: row.device, push: row.push, msgs: [] });
        per.get(row.device).msgs.push({ title: `⏰ אימון ${remindWord(p.remind)}: ${nick ? `${name} (${nick})` : name}`,
          body: `${o.start}${o.end ? ' עד ' + o.end : ''}${o.place ? ' · ' + o.place : ''}${p.note ? '\nלהביא: ' + p.note : ''}` });
      }
    }
  }
  return per.size ? deliver(env, per, 'practice') : 0;
}

/* ---------------- retention (what the privacy page promises) ---------------- */

export async function cleanup(env, now = Date.now()) {
  const day = n => ilDay(new Date(now - n * 864e5));
  const yearAgo = now - 365 * 864e5;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM activity WHERE day < ?').bind(day(730)),            // usage log: 24 months
    env.DB.prepare('DELETE FROM feedback WHERE ts < ?').bind(now - 365 * 864e5),     // messages: 12 months
    env.DB.prepare('DELETE FROM pushlog WHERE day < ?').bind(day(90)),               // sent-notification counts: 90 days
    env.DB.prepare('DELETE FROM changes WHERE ts < ?').bind(now - 365 * 864e5),
    env.DB.prepare('DELETE FROM pending WHERE ts < ?').bind(now - 2 * 864e5),
    env.DB.prepare('DELETE FROM follows WHERE device IN (SELECT id FROM devices WHERE last_seen < ?)').bind(yearAgo), // a phone unused for a year
    env.DB.prepare('DELETE FROM nicks WHERE device IN (SELECT id FROM devices WHERE last_seen < ?)').bind(yearAgo),
    env.DB.prepare('DELETE FROM practices WHERE device IN (SELECT id FROM devices WHERE last_seen < ?)').bind(yearAgo),
    env.DB.prepare('DELETE FROM devices WHERE last_seen < ?').bind(yearAgo),
  ]);
}

// "מחיקת המידע שלי": everything tied to this phone's random id.
async function forgetDevice(env, device) {
  await env.DB.batch(['devices WHERE id', 'follows WHERE device', 'nicks WHERE device', 'practices WHERE device', 'pending WHERE device', 'activity WHERE device', 'feedback WHERE device']
    .map(t => env.DB.prepare(`DELETE FROM ${t}=?`).bind(device)));
}

/* ---------------- HTTP ---------------- */

async function readJSON(req, max = 64e3) {
  const t = await req.text(); if (t.length > max) throw new Error('too large');
  return JSON.parse(t || '{}');
}

async function saveState(env, b) {
  if (!DEVICE.test(b.device || '')) return json({ error: 'device' }, 400);
  const now = Date.now();
  const existed = await env.DB.prepare('SELECT 1 FROM devices WHERE id=?').bind(b.device).first();
  const prefs = b.prefs && typeof b.prefs === 'object' ? JSON.stringify({ change: !!b.prefs.change, eve: !!b.prefs.eve, result: !!b.prefs.result }) : null;
  const platform = ['ios', 'android', 'other'].includes(b.platform) ? b.platform : 'other';
  const stmts = [env.DB.prepare(`INSERT INTO devices(id,created,last_seen,platform,standalone,prefs) VALUES(?,?,?,?,?,COALESCE(?,'{"change":true,"eve":true,"result":false}'))
    ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen, platform=excluded.platform, standalone=MAX(devices.standalone,excluded.standalone), prefs=COALESCE(?,devices.prefs)`)
    .bind(b.device, now, now, platform, b.standalone ? 1 : 0, prefs, prefs)];
  if (Array.isArray(b.full) || Array.isArray(b.res)) {
    const full = (b.full || []).filter(k => TEAM.test(k)).slice(0, 30);
    const res = (b.res || []).filter(k => TEAM.test(k)).slice(0, 30);
    stmts.push(env.DB.prepare('DELETE FROM follows WHERE device=?').bind(b.device));
    const ins = env.DB.prepare('INSERT OR IGNORE INTO follows(device,team,kind) VALUES(?,?,?)');
    for (const k of full) stmts.push(ins.bind(b.device, k, 'full'));
    for (const k of res) stmts.push(ins.bind(b.device, k, 'res'));
    if (b.nicks && typeof b.nicks === 'object') {
      stmts.push(env.DB.prepare('DELETE FROM nicks WHERE device=?').bind(b.device));
      const nk = env.DB.prepare('INSERT OR REPLACE INTO nicks(device,team,nick) VALUES(?,?,?)');
      for (const k of full) {
        const n = String(b.nicks[k] || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
        if (n) stmts.push(nk.bind(b.device, k, n));
      }
    }
    if (Array.isArray(b.practices)) {
      const pr = cleanPractices(b.practices, b.pskips, new Set(full), b.pmoves);
      stmts.push(pr.list.length
        ? env.DB.prepare('INSERT INTO practices(device,data) VALUES(?,?) ON CONFLICT(device) DO UPDATE SET data=excluded.data').bind(b.device, JSON.stringify(pr))
        : env.DB.prepare('DELETE FROM practices WHERE device=?').bind(b.device));
    }
  }
  const act = env.DB.prepare('INSERT INTO activity(day,device,type,n) VALUES(?,?,?,1) ON CONFLICT(day,device,type) DO UPDATE SET n=n+1');
  stmts.push(act.bind(ilDay(), b.device, /^[a-z_]{2,20}$/.test(b.type || '') ? b.type : 'open'));
  if (!existed) stmts.push(act.bind(ilDay(), b.device, 'new'));
  if (b.standalone) stmts.push(act.bind(ilDay(), b.device, 'standalone'));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

const CORS = { 'Access-Control-Allow-Origin': 'https://ibasketball.co.il', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, x-admin-key' };

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p.startsWith('/api/') || p.startsWith('/cal/') || p === '/stats') await ensureSchema(env);
      if (p === '/api/data' && req.method === 'GET') {
        const t = await env.KV.get('pack');
        if (!t) return json({ error: 'no data yet' }, 503);
        return new Response(t, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
      }
      if (p === '/api/config') return json({ vapid: (await vapidOf(env)).publicKey });
      if (p === '/api/state' && req.method === 'POST') return saveState(env, await readJSON(req));
      if (p === '/api/event' && req.method === 'POST') {
        const b = await readJSON(req);
        if (!DEVICE.test(b.device || '') || !/^[a-z_]{2,20}$/.test(b.type || '')) return json({ error: 'bad' }, 400);
        await track(env, b.device, b.type);
        return json({ ok: true });
      }
      if (p === '/api/push' && req.method === 'POST') {
        const b = await readJSON(req);
        if (!DEVICE.test(b.device || '')) return json({ error: 'device' }, 400);
        const sub = b.subscription;
        const okEndpoint = typeof sub?.endpoint === 'string' && (sub.endpoint.startsWith('https://') || (env.DEV_ALLOW_HTTP_PUSH === '1' && sub.endpoint.startsWith('http://localhost')));
        if (sub && !(okEndpoint && sub.keys?.p256dh && sub.keys?.auth)) return json({ error: 'subscription' }, 400);
        await env.DB.prepare('UPDATE devices SET push=? WHERE id=?').bind(sub ? JSON.stringify({ endpoint: sub.endpoint, keys: sub.keys }) : null, b.device).run();
        await track(env, b.device, sub ? 'push_on' : 'push_off');
        return json({ ok: true });
      }
      if (p === '/api/feedback' && req.method === 'POST') {
        const b = await readJSON(req);
        const topics = ['wrong', 'team', 'push', 'cal', 'a11y', 'idea', 'other'];
        const text = String(b.text || '').trim().slice(0, 1500);
        if (!DEVICE.test(b.device || '') || !topics.includes(b.topic) || text.length < 2) return json({ error: 'bad' }, 400);
        const recent = await env.DB.prepare('SELECT COUNT(*) c FROM feedback WHERE device=? AND ts>?').bind(b.device, Date.now() - 864e5).first();
        if (recent.c >= 10) return json({ error: 'too many' }, 429);
        const teams = Array.isArray(b.teams) ? b.teams.filter(k => TEAM.test(k)).slice(0, 10) : [];
        const diag = b.diag && typeof b.diag === 'object'
          ? JSON.stringify(Object.fromEntries(Object.entries(b.diag).slice(0, 12).map(([k, v]) => [String(k).slice(0, 20), String(v).slice(0, 60)]))) : null;
        await env.DB.prepare('INSERT INTO feedback(ts,device,topic,source,text,contact,teams,platform,diag) VALUES(?,?,?,?,?,?,?,?,?)')
          .bind(Date.now(), b.device, b.topic, b.source === 'my' ? 'my' : 'help', text, String(b.contact || '').trim().slice(0, 120) || null,
            JSON.stringify(teams), ['ios', 'android', 'other'].includes(b.platform) ? b.platform : 'other', diag).run();
        await track(env, b.device, 'feedback');
        return json({ ok: true });
      }
      if (p === '/api/me' && req.method === 'GET') { // for "מה בדקנו בטלפון הזה" in Help
        const device = url.searchParams.get('device') || '';
        if (!DEVICE.test(device)) return json({ error: 'device' }, 400);
        const [d, cal] = await Promise.all([
          env.DB.prepare('SELECT push IS NOT NULL AS push FROM devices WHERE id=?').bind(device).first(),
          env.DB.prepare("SELECT MAX(day) day FROM activity WHERE device=? AND type='cal_fetch'").bind(device).first(),
        ]);
        return json({ known: !!d, push: !!d?.push, calDay: cal?.day || null }, 200, { 'cache-control': 'no-store' });
      }
      if (p === '/api/restore' && req.method === 'GET') { // the iPhone home-screen app picks up what was set up in Safari
        const device = url.searchParams.get('device') || '';
        if (!DEVICE.test(device)) return json({ error: 'device' }, 400);
        const [d, f, n, pr] = await Promise.all([
          env.DB.prepare('SELECT prefs FROM devices WHERE id=?').bind(device).first(),
          env.DB.prepare('SELECT team, kind FROM follows WHERE device=?').bind(device).all(),
          env.DB.prepare('SELECT team, nick FROM nicks WHERE device=?').bind(device).all(),
          env.DB.prepare('SELECT data FROM practices WHERE device=?').bind(device).first(),
        ]);
        if (!d) return json({ known: false }, 200, { 'cache-control': 'no-store' });
        const data = pr ? JSON.parse(pr.data) : { list: [], skips: {} };
        return json({ known: true, prefs: JSON.parse(d.prefs || '{}'), full: f.results.filter(r => r.kind === 'full').map(r => r.team), res: f.results.filter(r => r.kind === 'res').map(r => r.team),
          nicks: Object.fromEntries(n.results.map(r => [r.team, r.nick])), practices: data.list, pskips: data.skips, pmoves: data.moves || {} }, 200, { 'cache-control': 'no-store' });
      }
      if (p === '/api/forget' && req.method === 'POST') {
        const b = await readJSON(req);
        if (!DEVICE.test(b.device || '')) return json({ error: 'device' }, 400);
        await forgetDevice(env, b.device);
        return json({ ok: true });
      }
      if (p === '/api/test-push' && req.method === 'POST') {
        const b = await readJSON(req);
        if (!DEVICE.test(b.device || '')) return json({ error: 'device' }, 400);
        if (await env.KV.get('test:' + b.device)) return json({ error: 'wait a minute' }, 429);
        await env.KV.put('test:' + b.device, '1', { expirationTtl: 60 });
        const row = await env.DB.prepare('SELECT push FROM devices WHERE id=?').bind(b.device).first();
        const vapid = await vapidOf(env);
        if (!row?.push) return json({ error: 'push not enabled' }, 400);
        const r = await sendPush(JSON.parse(row.push), { title: 'טיפ-אוף ✓', body: 'ההתראות עובדות. נעדכן כשמשהו משתנה במשחקים שלכם.', url: '/', tag: 'test' }, vapid);
        await logPush(env, 'test', r.ok ? 1 : 0, r.ok ? 0 : 1);
        if (r.gone) await env.DB.prepare('UPDATE devices SET push=NULL WHERE id=?').bind(b.device).run();
        return json({ ok: r.ok, status: r.status });
      }
      const cal = p.match(/^\/cal\/([a-f0-9-]{36})\.ics$/);
      if (cal) {
        const [pack, follows, nicks, prac] = await Promise.all([getPack(env), env.DB.prepare("SELECT team FROM follows WHERE device=? AND kind='full'").bind(cal[1]).all(),
          env.DB.prepare('SELECT team, nick FROM nicks WHERE device=?').bind(cal[1]).all(), env.DB.prepare('SELECT data FROM practices WHERE device=?').bind(cal[1]).first()]);
        if (!pack) return new Response('no data', { status: 503 });
        ctx.waitUntil(track(env, cal[1], 'cal_fetch').catch(() => {}));
        return new Response(icsFor(pack, follows.results.map(r => r.team), url.host, Object.fromEntries(nicks.results.map(r => [r.team, r.nick])), prac ? JSON.parse(prac.data) : null), {
          headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'public, max-age=900', 'content-disposition': 'inline; filename="tipoff.ics"' },
        });
      }
      if (p === '/stats') {
        if (!keyAllowed(env, url)) return new Response('לא נמצא', { status: 404 });
        return new Response(await statsPage(env, await getPack(env)), { headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex', 'cache-control': 'no-store' } });
      }
      if (p === '/api/sync' && req.method === 'POST') {
        if (!keyAllowed(env, url, req)) return json({ error: 'key' }, 403);
        return json(await runSync(env, { source: 'manual' }));
      }
      // Plan B: if the association blocks the server, the same data can be sent from a browser (tools/browser-sync.js)
      if (p === '/api/ingest') {
        if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
        if (req.method !== 'POST' || !keyAllowed(env, url, req)) return json({ error: 'key' }, 403, CORS);
        const raw = await readJSON(req, 20e6);
        if (!Array.isArray(raw.leagues) || !Array.isArray(raw.events) || !Array.isArray(raw.venues)) return json({ error: 'shape' }, 400, CORS);
        return json(await runSync(env, { raw, source: 'browser' }), 200, CORS);
      }
      if (p === '/api/dev-quiet' && env.DEV_ALLOW_HTTP_PUSH === '1' && keyAllowed(env, url, req)) {
        await env.KV.put('dev:quiet', url.searchParams.get('on') || '0');
        if (url.searchParams.get('flush')) return json({ sent: await flushPending(env) });
        if (url.searchParams.get('cleanup')) { await cleanup(env); return json({ ok: true }); }
        if (url.searchParams.get('practice')) return json({ sent: await practiceReminders(env, new Date(url.searchParams.get('practice'))) });
        return json({ ok: true });
      }
      if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    await ensureSchema(env);
    if (event.cron === '*/15 * * * *') { await practiceReminders(env); return; }
    if (event.cron === env.EVENING_CRON || event.cron === '0 17,18 * * *') {
      if (ilHour() === 20) { await eveningReminders(env); await cleanup(env); }
      return;
    }
    await runSync(env);
    await flushPending(env); // morning: what was held overnight
  },
};
