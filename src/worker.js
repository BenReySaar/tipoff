// טיפ-אוף server: serves the app, syncs the schedule every hour, sends push notifications,
// serves each family's calendar feed, and counts usage.
import { fetchSeason, buildPack, diffPacks, attachChangeLog, ymd } from './ibba.js';
import { sendPush } from './push.js';
import { icsFor } from './ics.js';
import { statsPage } from './stats.js';

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DEVICE = /^[a-f0-9-]{36}$/;
const TEAM = /^[^|]{1,12}\|.{1,80}$/;

const ilDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const ilHour = (d = new Date()) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hourCycle: 'h23' }).format(d);
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

function vapidOf(env) {
  if (!env.VAPID_PUBLIC || !env.VAPID_PRIVATE_JWK) return null;
  return { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT || 'mailto:admin@example.com' };
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
    raw = raw || await fetchSeason({ season: env.SEASON || '2026', userAgent: `Mozilla/5.0 (compatible; TipOff/1.0; +${env.APP_URL || 'https://tipoff'})` });
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

function messageFor(change, teamKey) {
  const g = change.game, b = change.before;
  const mineHome = g.homeKey === teamKey;
  const team = mineHome ? g.home : g.away, opp = mineHome ? g.away : g.home;
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
    const r = await env.DB.prepare(`SELECT f.device, f.team, f.kind, d.push, d.prefs FROM follows f JOIN devices d ON d.id=f.device
      WHERE d.push IS NOT NULL AND f.team IN (${part.map(() => '?').join(',')})`).bind(...part).all();
    rows.push(...r.results);
  }
  return rows;
}

async function deliver(env, perDevice, kind) {
  const vapid = vapidOf(env); if (!vapid) return 0;
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
      b.msgs.push(messageFor(c, row.team));
    }
  }
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
        title: `מחר: ${pack.tm[ti][0]} ב־${fromD(g[1]).hm}`,
        body: `נגד ${opp} · ${hallShort(pack.vn[g[5]])}\n👕 ${home ? 'משחק בית' : 'משחק חוץ'} – לבדוק צבע גופייה`,
      });
    }
  }
  for (const p of per.values()) p.msgs.sort((a, b) => a.title.localeCompare(b.title));
  return deliver(env, per, 'eve');
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
      if (p === '/api/data' && req.method === 'GET') {
        const t = await env.KV.get('pack');
        if (!t) return json({ error: 'no data yet' }, 503);
        return new Response(t, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
      }
      if (p === '/api/config') return json({ vapid: env.VAPID_PUBLIC || null });
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
      if (p === '/api/test-push' && req.method === 'POST') {
        const b = await readJSON(req);
        if (!DEVICE.test(b.device || '')) return json({ error: 'device' }, 400);
        if (await env.KV.get('test:' + b.device)) return json({ error: 'wait a minute' }, 429);
        await env.KV.put('test:' + b.device, '1', { expirationTtl: 60 });
        const row = await env.DB.prepare('SELECT push FROM devices WHERE id=?').bind(b.device).first();
        const vapid = vapidOf(env);
        if (!row?.push || !vapid) return json({ error: 'push not enabled' }, 400);
        const r = await sendPush(JSON.parse(row.push), { title: 'טיפ-אוף ✓', body: 'ההתראות עובדות. נעדכן כשמשהו משתנה במשחקים שלכם.', url: '/', tag: 'test' }, vapid);
        await logPush(env, 'test', r.ok ? 1 : 0, r.ok ? 0 : 1);
        if (r.gone) await env.DB.prepare('UPDATE devices SET push=NULL WHERE id=?').bind(b.device).run();
        return json({ ok: r.ok, status: r.status });
      }
      const cal = p.match(/^\/cal\/([a-f0-9-]{36})\.ics$/);
      if (cal) {
        const [pack, follows] = await Promise.all([getPack(env), env.DB.prepare("SELECT team FROM follows WHERE device=? AND kind='full'").bind(cal[1]).all()]);
        if (!pack) return new Response('no data', { status: 503 });
        ctx.waitUntil(track(env, cal[1], 'cal_fetch').catch(() => {}));
        return new Response(icsFor(pack, follows.results.map(r => r.team), url.host), {
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
      if (p.startsWith('/api/')) return json({ error: 'not found' }, 404);
      return env.ASSETS.fetch(req);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === env.EVENING_CRON || event.cron === '0 17,18 * * *') {
      if (ilHour() === 20) await eveningReminders(env);
      return;
    }
    await runSync(env);
  },
};
