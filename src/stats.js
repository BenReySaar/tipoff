// Private usage page: /stats?key=<ADMIN_KEY>

const ilDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const daysAgo = n => ilDay(new Date(Date.now() - n * 864e5));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('he-IL');
const when = ms => ms ? new Date(ms).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const ACTIONS = {
  open: 'פתחו את האפליקציה', new: 'מכשירים חדשים', follow: 'הוסיפו או הסירו קבוצה', standalone: 'פתחו מהמסך הבית',
  push_on: 'הפעילו התראות', push_off: 'כיבו התראות', nav: 'לחצו ניווט', calendar: 'הוסיפו משחק ליומן', cal_sub: 'חיברו יומן מתעדכן',
  cal_fetch: 'יומן מתעדכן נקרא', share_game: 'שיתפו משחק', share_app: 'שיתפו את האפליקציה', social: 'לחצו על רשת חברתית', prefs: 'שינו הגדרות התראות',
};

export async function statsPage(env, pack) {
  const DB = env.DB;
  const today = ilDay(), d7 = daysAgo(6), d30 = daysAgo(29);
  const one = (sql, ...b) => DB.prepare(sql).bind(...b).first();
  const all = (sql, ...b) => DB.prepare(sql).bind(...b).all().then(r => r.results);
  const now = Date.now();

  const [dau, wau, mau, tot, withTeam, returning, series, newSeries, actions, topTeams, pushes, changes, allFollows] = await Promise.all([
    one("SELECT COUNT(DISTINCT device) c FROM activity WHERE day=? AND type='open'", today),
    one("SELECT COUNT(DISTINCT device) c FROM activity WHERE day>=? AND type='open'", d7),
    one("SELECT COUNT(DISTINCT device) c FROM activity WHERE day>=? AND type='open'", d30),
    one("SELECT COUNT(*) c, SUM(standalone) home, SUM(push IS NOT NULL) push, SUM(platform='ios') ios, SUM(platform='android') android FROM devices"),
    one("SELECT COUNT(DISTINCT device) c FROM follows WHERE kind='full'"),
    one('SELECT COUNT(*) c FROM devices WHERE created < ? AND last_seen > ?', now - 7 * 864e5, now - 7 * 864e5),
    all("SELECT day, COUNT(DISTINCT device) c FROM activity WHERE day>=? AND type='open' GROUP BY day ORDER BY day", d30),
    all("SELECT day, COUNT(*) c FROM activity WHERE day>=? AND type='new' GROUP BY day ORDER BY day", d30),
    all('SELECT type, COUNT(DISTINCT device) devices, SUM(n) times FROM activity WHERE day>=? GROUP BY type ORDER BY devices DESC', d30),
    all("SELECT team, COUNT(*) c FROM follows WHERE kind='full' GROUP BY team ORDER BY c DESC LIMIT 15"),
    all('SELECT kind, SUM(sent) sent, SUM(failed) failed FROM pushlog WHERE day>=? GROUP BY kind', d30),
    all('SELECT kind, COUNT(*) c FROM changes WHERE ts>? GROUP BY kind', now - 7 * 864e5),
    all("SELECT team, kind FROM follows"),
  ]);
  const sync = JSON.parse(await env.KV.get('sync:status') || 'null');
  const lastOk = JSON.parse(await env.KV.get('sync:last-ok') || 'null');

  // by age group and by club, from the league slug in each team key
  const ageOfSlug = new Map((pack?.lg || []).map(l => [l[1], l[2]]));
  const ageName = new Map((pack?.ages || []).map(a => [a[0], a[1] + (a[2] === 'F' ? ' (בנות)' : '')]));
  const byAge = new Map(), byClub = new Map();
  for (const f of allFollows) {
    if (f.kind !== 'full') continue;
    const [slug, name] = f.team.split('|');
    const age = ageName.get(ageOfSlug.get(slug)) || 'לא ידוע';
    byAge.set(age, (byAge.get(age) || 0) + 1);
    const club = name.split(' ').slice(0, 2).join(' ');
    byClub.set(club, (byClub.get(club) || 0) + 1);
  }
  const leagueName = new Map((pack?.lg || []).map(l => [l[1], l[0]]));

  // 30-day bars
  const days = [...Array(30)].map((_, i) => daysAgo(29 - i));
  const sMap = new Map(series.map(r => [r.day, r.c])), nMap = new Map(newSeries.map(r => [r.day, r.c]));
  const max = Math.max(1, ...days.map(d => sMap.get(d) || 0));
  const W = 600, H = 150, bw = W / 30;
  const bars = days.map((d, i) => {
    const v = sMap.get(d) || 0, nv = nMap.get(d) || 0, h = v / max * (H - 24), nh = nv / max * (H - 24);
    return `<g><title>${d}: ${v} פעילים, ${nv} חדשים</title><rect x="${W - (i + 1) * bw + 2}" y="${H - 18 - h}" width="${bw - 4}" height="${h}" fill="var(--a)" rx="2"/>`
      + `<rect x="${W - (i + 1) * bw + 2}" y="${H - 18 - nh}" width="${bw - 4}" height="${nh}" fill="var(--b)" rx="2"/>`
      + ((29 - i) % 7 === 0 ? `<text x="${W - (i + 0.5) * bw}" y="${H - 4}" font-size="10" text-anchor="middle" fill="var(--m)">${+d.slice(8)}.${+d.slice(5, 7)}</text>` : '') + '</g>';
  }).join('');

  const tile = (n, label, sub = '') => `<div class="t"><b>${fmt(n)}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const table = (rows, cols) => `<table><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c(r)}</td>`).join('')}</tr>`).join('') || '<tr><td>אין עדיין נתונים</td></tr>'}</tbody></table>`;
  const sortMap = m => [...m].sort((a, b) => b[1] - a[1]);
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';

  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>טיפ-אוף · נתוני שימוש</title><style>
:root{--bg:#EEF0F4;--s:#fff;--i:#141A2B;--m:#5A6276;--l:#D9DDE6;--a:#1C3358;--b:#DF5419;--ok:#1F8A4C;--bad:#B4372A}
@media (prefers-color-scheme:dark){:root{--bg:#0D111A;--s:#161C29;--i:#E8EBF2;--m:#9AA2B5;--l:#283044;--a:#6E8FD0;--b:#F26B2F;--ok:#4CC17E;--bad:#EE6E5F}}
body{margin:0;background:var(--bg);color:var(--i);font:15px/1.5 system-ui,"Segoe UI",Arial,sans-serif}
main{max-width:900px;margin:0 auto;padding:20px max(16px,env(safe-area-inset-left)) 40px;display:flex;flex-direction:column;gap:18px}
h1{margin:0;font-size:26px}h2{margin:0 0 8px;font-size:17px}
.sub{color:var(--m);font-size:13px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.t{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:12px 14px;display:flex;flex-direction:column}
.t b{font-size:28px;font-variant-numeric:tabular-nums}.t span{font-size:13px}.t small{color:var(--m);font-size:12px}
.card{background:var(--s);border:1px solid var(--l);border-radius:14px;padding:14px;overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}td{padding:6px 8px;border-top:1px solid var(--l);font-variant-numeric:tabular-nums}tr:first-child td{border-top:0}
td:not(:first-child){text-align:left;white-space:nowrap}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.st{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:600;font-size:13px}.ok{background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok)}.bad{background:color-mix(in srgb,var(--bad) 15%,transparent);color:var(--bad)}
.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-inline:8px 4px}
svg{width:100%;height:auto;display:block}
</style></head><body><main>
<div><h1>טיפ-אוף · נתוני שימוש</h1><div class="sub">עודכן ${when(now)}. "משתמש" = מכשיר אחד (טלפון או מחשב). הורה עם שני מכשירים נספר פעמיים.</div></div>

<div class="tiles">
${tile(dau?.c, 'פעילים היום')}${tile(wau?.c, 'פעילים ב־7 ימים')}${tile(mau?.c, 'פעילים ב־30 ימים')}
${tile(tot?.c, 'מכשירים בסך הכל', `${fmt(withTeam?.c)} עם קבוצה לפחות`)}
${tile(tot?.push, 'התראות פעילות', pct(tot?.push, withTeam?.c) + ' ממי שבחר קבוצה')}
${tile(tot?.home, 'הוסיפו למסך הבית', `אייפון ${fmt(tot?.ios)} · אנדרואיד ${fmt(tot?.android)}`)}
${tile(returning?.c, 'חוזרים', 'מכשירים ותיקים משבוע שעבר שנכנסו השבוע')}
</div>

<div class="card"><h2>פעילים בכל יום, 30 ימים</h2><div class="sub lg"><i style="background:var(--a)"></i>פעילים<i style="background:var(--b)"></i>חדשים</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="פעילים יומיים">${bars}</svg></div>

<div class="cols">
<div class="card"><h2>מה עושים באפליקציה (30 ימים)</h2>${table(actions, [r => esc(ACTIONS[r.type] || r.type), r => fmt(r.devices) + ' מכשירים', r => fmt(r.times) + ' פעמים'])}</div>
<div class="card"><h2>התראות (30 ימים)</h2>${table(pushes, [r => ({ change: 'שינוי במשחק', result: 'תוצאה', eve: 'תזכורת ערב', test: 'בדיקה' }[r.kind] || r.kind), r => fmt(r.sent) + ' נשלחו', r => r.failed ? fmt(r.failed) + ' נכשלו' : ''])}
<h2 style="margin-top:14px">שינויים שזוהו בלוח (7 ימים)</h2>${table(changes, [r => ({ moved: 'שעה או תאריך', venue: 'אולם', 'moved+venue': 'מועד ואולם', removed: 'ירד מהלוח', result: 'תוצאות שנכנסו' }[r.kind] || r.kind), r => fmt(r.c)])}</div>
</div>

<div class="cols">
<div class="card"><h2>הקבוצות הכי נעקבות</h2>${table(topTeams, [r => esc(r.team.split('|')[1]) + `<div class="sub">${esc(leagueName.get(r.team.split('|')[0]) || '')}</div>`, r => fmt(r.c)])}</div>
<div class="card"><h2>לפי מועדון</h2>${table(sortMap(byClub).slice(0, 12), [r => esc(r[0]), r => fmt(r[1])])}
<h2 style="margin-top:14px">לפי גיל</h2>${table(sortMap(byAge), [r => esc(r[0]), r => fmt(r[1])])}</div>
</div>

<div class="card"><h2>סנכרון מול אתר האיגוד</h2>
${sync ? `<p><span class="st ${sync.ok ? 'ok' : 'bad'}">${sync.ok ? 'תקין' : 'נכשל'}</span> ריצה אחרונה ${when(sync.at)} (${esc(sync.source)})${sync.ok ? ` · ${fmt(sync.games)} משחקים · ${fmt(sync.changes)} שינויים · ${fmt(sync.pushed)} התראות` : `<br><span class="sub">${esc(sync.error)}</span>`}</p>` : '<p>עוד לא רץ סנכרון.</p>'}
${lastOk && !sync?.ok ? `<p class="sub">סנכרון תקין אחרון: ${when(lastOk.at)}. האפליקציה ממשיכה להציג את הנתונים ממנו.</p>` : ''}
</div>
</main></body></html>`;
}
