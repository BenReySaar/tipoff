// Private usage page: /stats?key=<ADMIN_KEY>

const ilDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const daysAgo = n => ilDay(new Date(Date.now() - n * 864e5));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Number(n || 0).toLocaleString('he-IL');
const when = ms => ms ? new Date(ms).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const TOPIC = { a11y: 'נגישות', wrong: 'פרט במשחק לא נכון', team: 'לא מוצאים קבוצה', push: 'התראות', cal: 'יומן', idea: 'רעיון', other: 'אחר' };

const DIAG = { os: 'מערכת', browser: 'דפדפן', home: 'מסך הבית', push: 'התראות', cal: 'יומן', teams: 'קבוצות' };

const ACTIONS = {
  open: 'פתחו את האפליקציה', new: 'מכשירים חדשים', follow: 'הוסיפו או הסירו קבוצה', standalone: 'פתחו מהמסך הבית',
  push_on: 'הפעילו התראות', push_off: 'כיבו התראות', nav: 'לחצו ניווט', calendar: 'הוסיפו משחק ליומן', cal_sub: 'חיברו יומן מתעדכן',
  cal_fetch: 'יומן מתעדכן נקרא', feedback: 'שלחו הודעה מ"עזרה" או רעיון', share_team: 'שיתפו קישור לקבוצה', invite_open: 'נכנסו מקישור של קבוצה', invite_follow: 'הצטרפו לקבוצה מקישור', invite_skip: 'נכנסו מקישור ולא הצטרפו', onboard_skip: 'דילגו על המדריך', install: 'התקינו (אנדרואיד)', share_game: 'שיתפו משחק', share_app: 'שיתפו את האפליקציה', share_app_wa: 'שיתפו את האפליקציה בוואטסאפ', share_app_fb: 'שיתפו את האפליקציה בפייסבוק', share_app_tg: 'שיתפו את האפליקציה בטלגרם', share_app_native: 'שיתפו את האפליקציה (תפריט השיתוף)', share_app_copy: 'העתיקו קישור לאפליקציה', share_team_native: 'שיתפו קבוצה (תפריט השיתוף)', season: 'פתחו את כל משחקי העונה', social: 'לחצו על רשת חברתית', prefs: 'שינו הגדרות התראות', nick: 'נתנו כינוי לקבוצה', remove_team: 'הסירו קבוצה מהתפריט', details: 'פתחו פירוט מול היריבה', gmaps: 'לחצו Google Maps', wrong_open: 'לחצו "משהו לא נכון?"', forget: 'מחקו את המידע שלהם', diag_fix: 'לחצו על תיקון באבחון', invite_close: 'סגרו את "הזמינו הורים"', howto_open: 'פתחו את מדריך ההוספה למסך הבית', install_copy: 'העתיקו קישור כדי לעבור לספארי', install_send: 'שלחו לעצמם קישור מהמחשב', installed_open: 'פתחו לראשונה מהמסך הבית', howto_auto: 'קיבלו את מדריך ההתקנה אחרי בחירת קבוצה (אייפון)', pushask_show: 'קיבלו הצעה להפעיל התראות אחרי בחירת קבוצה', pushask_no: 'דחו את ההצעה להפעיל התראות', edit_open: 'פתחו עריכת קבוצות', invite_dismiss: 'סגרו את חלון ההזמנה בלחיצה מחוץ לו', practice_add: 'הוסיפו אימון קבוע', practice_top: 'לחצו "+ אימון" למעלה', promo_show: 'ראו את החלון "חדש: תזכורת לאימונים"', promo_go: 'לחצו "להוספת אימון" בחלון החדש', promo_no: 'סגרו את חלון החדש', demo_play: 'פתחו את סרטון ההדגמה', practice_skip: 'ביטלו אימון לתאריך אחד', practice_one: 'שינו אימון בודד (מועד או מקום)', restore: 'אפליקציה במסך הבית קיבלה את ההגדרות מספארי', clash_seen: 'ראו אזהרה "באותה שעה"', report: 'דיווחו "איך נגמר?"', report_ok: 'אישרו "נכון" לתוצאה שהורה אחר דיווח', rep_ask: 'פתחו "נכון?" או "דיווחים שונים"', ks_invite: 'הזמינו הורים מהמאזן של קט-סל', practice: 'שמרו שינוי באימונים', opp_open: 'פתחו את הלוז של היריבה', grow_chg_seen: 'ראו "המשחק זז. ההורים בקבוצה יודעים?"', grow_chg_wa: 'שלחו בוואטסאפ אחרי משחק שזז', grow_chg_no: 'סגרו את בקשת השיתוף (משחק שזז)', grow_prac_seen: 'ראו "שלחו את האימונים להורים"', grow_prac_wa: 'שלחו את האימונים בוואטסאפ', grow_prac_no: 'סגרו את בקשת השיתוף (אימונים)', opp_all: 'פתחו את כל המשחקים של היריבה', tp_add: 'הוסיפו את לוז האימונים של הקבוצה', tp_update: 'עדכנו מהקבוצה', tp_no: 'דחו לוז או עדכון מהקבוצה',
};

// One club often appears under several names ("הפועל מרנין טבעון", "הפועל קרית טבעון", "הפועל ק.טבעון מרנין").
// Names that share a distinctive word are counted together, under the most followed name.
const STOP = new Set(['הפועל', 'מכבי', 'אליצור', 'ביתר', 'בני', 'עירוני', 'אסא', 'אס', 'מועדון', 'כדורסל', 'בנות', 'צעירים', 'קרית', 'רמת', 'תל', 'גבעת', 'כפר', 'נווה', 'עין', 'בית', 'אבן', 'מתנס', 'עלה', 'אור', 'גני', 'ראש', 'מעלה', 'נוער', 'ילדים', 'א', 'ב', 'ג']);
const clubWords = n => n.replace(/["״׳'`]/g, '').replace(/\./g, ' ').replace(/[-/–]/g, ' ').split(/\s+/).map(w => w === 'ק' ? 'קרית' : w)
  .filter(w => w.length >= 3 && !STOP.has(w));
export function groupClubs(names) {
  const list = [...names], parent = list.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const byWord = new Map();
  // same organisation (first word) and a shared distinctive word
  const org = n => n.replace(/["״׳'`.]/g, '').split(/\s+/)[0];
  list.forEach(([n], i) => { for (const w0 of clubWords(n)) { const w = org(n) + '|' + w0; if (byWord.has(w)) parent[find(i)] = find(byWord.get(w)); else byWord.set(w, i); } });
  const groups = new Map();
  list.forEach(([n, c], i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push([n, c]); });
  const out = new Map();
  for (const g of groups.values()) {
    g.sort((a, b) => b[1] - a[1]);
    const total = g.reduce((s, x) => s + x[1], 0);
    out.set(g[0][0] + (g.length > 1 ? ` (+${g.length - 1} ${g.length === 2 ? 'שם נוסף' : 'שמות נוספים'})` : ''), total);
  }
  return out;
}

const addD = (s, n) => new Date(Date.parse(s + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const weekOf = s => addD(s, -new Date(Date.parse(s + 'T12:00:00Z')).getUTCDay()); // Sunday
const dmy = s => `${+s.slice(8)}.${+s.slice(5, 7)}`;
const share = (a, b) => b ? Math.round(a / b * 100) : null;

/** The "what to improve" numbers, all from data already stored. Exported for tests. */
export function insights({ today, newRows, openRows, evRows, follows, devices, practiced, pack, pushNow }) {
  const opens = new Map();
  for (const r of openRows) { if (!opens.has(r.device)) opens.set(r.device, new Set()); opens.get(r.device).add(r.day); }
  const first = new Map();
  for (const r of newRows) if (!first.has(r.device) || r.day < first.get(r.device)) first.set(r.device, r.day);
  const ev = new Map(); // type -> Map(device -> Set(days))
  for (const r of evRows) { if (!ev.has(r.type)) ev.set(r.type, new Map()); const m = ev.get(r.type); if (!m.has(r.device)) m.set(r.device, new Set()); m.get(r.device).add(r.day); }
  const evDevs = t => ev.get(t) || new Map();

  // 1) came back within 7 days of the first visit, by week of the first visit
  const weeks = new Map();
  for (const [dev, f] of first) {
    const w = weekOf(f); if (!weeks.has(w)) weeks.set(w, { n: 0, measured: 0, back: 0 });
    const x = weeks.get(w); x.n++;
    if (addD(f, 7) > today) continue; // too early to tell
    x.measured++;
    const end = addD(f, 7);
    if ([...(opens.get(dev) || [])].some(d => d > f && d <= end)) x.back++;
  }
  const cohorts = [...weeks].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 6).map(([w, x]) => ({ w, ...x }));
  const meas = cohorts.reduce((a, c) => a + c.measured, 0), back = cohorts.reduce((a, c) => a + c.back, 0);

  // 2) funnel for devices that arrived in the last 30 days
  const d30 = addD(today, -29), since = Date.parse(d30 + 'T00:00:00+02:00');
  const withTeam = new Set(follows.map(f => f.device));
  const base = devices.filter(d => d.created >= since);
  const funnel = [
    ['נכנסו לאפליקציה', base.length],
    ['בחרו קבוצה', base.filter(d => withTeam.has(d.id)).length],
    ['הפעילו התראות', base.filter(d => d.p).length],
    ['פתחו מהמסך הבית', base.filter(d => d.s).length],
    ['הוסיפו אימון', base.filter(d => practiced.has(d.id)).length],
  ];

  // 3) game days: did the family open the app on a day their team played (last 14 days, up to today)
  const d14 = addD(today, -13), created = new Map(devices.map(d => [d.id, d.created]));
  const playDays = new Map(); // team key -> Set(days)
  if (pack) {
    const keyOf = ti => pack.lg[pack.tm[ti][1]][1] + '|' + pack.tm[ti][0];
    for (const g of pack.g) {
      const day = '20' + g[1].slice(0, 2) + '-' + g[1].slice(2, 4) + '-' + g[1].slice(4, 6);
      if (day < d14 || day > today) continue;
      for (const ti of [g[3], g[4]]) { const k = keyOf(ti); if (!playDays.has(k)) playDays.set(k, new Set()); playDays.get(k).add(day); }
    }
  }
  const pairs = new Set();
  for (const f of follows) for (const day of playDays.get(f.team) || []) {
    const c = created.get(f.device); if (c && Date.parse(day + 'T23:59:59+02:00') < c) continue; // device did not exist yet
    pairs.add(f.device + '|' + day);
  }
  let gOpen = 0, gGo = 0;
  const navD = evDevs('nav'), calD = evDevs('calendar'), gmD = evDevs('gmaps');
  for (const pr of pairs) {
    const [dev, day] = pr.split('|');
    if (opens.get(dev)?.has(day)) gOpen++;
    if (navD.get(dev)?.has(day) || calD.get(dev)?.has(day) || gmD.get(dev)?.has(day)) gGo++;
  }

  // 4) turned notifications off (30 days)
  const off = evDevs('push_off').size;

  // 5) where new devices came from: a parent's team link on their first day
  const new30 = [...first].filter(([, f]) => f >= d30);
  const inv = evDevs('invite_open');
  const viaLink = new30.filter(([dev, f]) => inv.get(dev)?.has(f)).length;
  const joined = evDevs('invite_follow').size;

  // new features
  const adultSlugs = new Set((pack?.lg || []).filter(l => (pack.ages.find(a => a[0] === l[2]) || [])[3]).map(l => l[1]));
  const adultDevs = new Set(follows.filter(f => adultSlugs.has(f.team.split('|')[0])).map(f => f.device)).size;

  return { cohorts, retention: share(back, meas), retMeasured: meas, funnel,
    game: { days: pairs.size, open: share(gOpen, pairs.size), go: share(gGo, pairs.size) },
    push: { off, pct: share(off, pushNow + off) },
    source: { n: new30.length, link: viaLink, pct: share(viaLink, new30.length), joined },
    features: { adultDevs, clash: evDevs('clash_seen').size } };
}

export async function statsPage(env, pack) {
  const DB = env.DB;
  const today = ilDay(), d7 = daysAgo(6), d30 = daysAgo(29);
  const one = (sql, ...b) => DB.prepare(sql).bind(...b).first();
  const all = (sql, ...b) => DB.prepare(sql).bind(...b).all().then(r => r.results);
  const now = Date.now();

  const [dau, wau, mau, tot, withTeam, returning, series, newSeries, actions, topTeams, pushes, changes, allFollows, fb, fbCount] = await Promise.all([
    one("SELECT COUNT(DISTINCT device) c FROM activity WHERE day=? AND type='open'", today),
    one("SELECT COUNT(DISTINCT device) c FROM activity WHERE day>=? AND type='open'", d7),
    one("SELECT COUNT(DISTINCT device) c FROM activity WHERE day>=? AND type='open'", d30),
    one("SELECT COUNT(*) c, SUM(standalone) home, SUM(push IS NOT NULL) push, SUM(platform='ios') ios, SUM(platform='android') android FROM devices"),
    one("SELECT COUNT(DISTINCT device) c FROM follows WHERE kind='full'"),
    one('SELECT COUNT(*) c FROM devices WHERE created < ? AND last_seen > ?', now - 7 * 864e5, now - 7 * 864e5),
    all("SELECT day, COUNT(DISTINCT device) c FROM activity WHERE day>=? AND type='open' GROUP BY day ORDER BY day", d30),
    all("SELECT day, COUNT(*) c FROM activity WHERE day>=? AND type='new' GROUP BY day ORDER BY day", d30),
    all('SELECT type, COUNT(DISTINCT device) devices, SUM(n) times FROM activity WHERE day>=? GROUP BY type ORDER BY devices DESC', d30),
    all("SELECT team, SUM(kind='full') c, SUM(kind='res') r FROM follows GROUP BY team ORDER BY c DESC, r DESC, team"),
    all('SELECT kind, SUM(sent) sent, SUM(failed) failed FROM pushlog WHERE day>=? GROUP BY kind', d30),
    all('SELECT kind, COUNT(*) c FROM changes WHERE ts>? GROUP BY kind', now - 7 * 864e5),
    all("SELECT team, kind FROM follows"),
    all('SELECT ts, topic, source, text, contact, teams, platform, diag FROM feedback ORDER BY ts DESC LIMIT 60'),
    one('SELECT COUNT(*) c FROM feedback WHERE ts>?', now - 30 * 864e5),
  ]);
  const [newRows, openRows, evRows, followRows, devRows, pracRows] = await Promise.all([
    all("SELECT day, device FROM activity WHERE type='new' AND day>=?", daysAgo(55)),
    all("SELECT day, device FROM activity WHERE type='open' AND day>=?", daysAgo(55)),
    all("SELECT day, device, type FROM activity WHERE day>=? AND type IN ('invite_open','invite_follow','push_off','nav','calendar','gmaps','clash_seen')", d30),
    all("SELECT device, team FROM follows WHERE kind='full'"),
    all('SELECT id, created, push IS NOT NULL p, standalone s FROM devices'),
    all('SELECT device FROM practices'),
  ]);
  const I = insights({ today, newRows, openRows, evRows, follows: followRows, devices: devRows, practiced: new Set(pracRows.map(r => r.device)), pack, pushNow: tot?.push || 0 });
  const sync = JSON.parse(await env.KV.get('sync:status') || 'null');
  const lastOk = JSON.parse(await env.KV.get('sync:last-ok') || 'null');

  // by age group and by club, from the league slug in each team key
  const ageOfSlug = new Map((pack?.lg || []).map(l => [l[1], l[2]]));
  const ageName = new Map((pack?.ages || []).map(a => [a[0], a[1] + (a[2] === 'F' ? (a[3] ? ' (נשים)' : ' (בנות)') : '')]));
  const byAge = new Map(), names = new Map();
  for (const f of allFollows) {
    if (f.kind !== 'full') continue;
    const [slug, name] = f.team.split('|');
    const age = ageName.get(ageOfSlug.get(slug)) || 'לא ידוע';
    byAge.set(age, (byAge.get(age) || 0) + 1);
    names.set(name, (names.get(name) || 0) + 1);
  }
  const byClub = groupClubs(names);
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
.ins{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}
.in b.big{font-size:30px;font-variant-numeric:tabular-nums;display:block;line-height:1.2}.in p{margin:4px 0}.in .fix{color:var(--m);font-size:13px;border-top:1px solid var(--l);margin-top:8px;padding-top:8px}
.fn{display:flex;flex-direction:column;gap:6px}.fn div{display:grid;grid-template-columns:120px 1fr 70px;gap:8px;align-items:center;font-size:14px}.fn i{display:block;height:14px;border-radius:4px;background:var(--a);min-width:2px}.fn em{font-style:normal;text-align:left;font-variant-numeric:tabular-nums}
details summary{cursor:pointer;font-weight:600}
.fbl{display:flex;flex-direction:column}.fbi{border-top:1px solid var(--l);padding:12px 0}.fbi:first-child{border-top:0;padding-top:0}.fbh{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.fbi p{margin:6px 0;white-space:pre-wrap}
</style></head><body><main>
<div><h1>טיפ-אוף · נתוני שימוש</h1><div class="sub">עודכן ${when(now)}. "משתמש" = מכשיר אחד (טלפון או מחשב). הורה עם שני מכשירים נספר פעמיים. בסך הכל ${fmt(tot?.c)} מכשירים, ${fmt(withTeam?.c)} מהם עם קבוצה.</div></div>

<div class="tiles">
${tile(dau?.c, 'פעילים היום')}${tile(wau?.c, 'פעילים ב־7 ימים')}${tile(mau?.c, 'פעילים ב־30 ימים')}
${tile(fbCount?.c, 'הודעות מהורים', '30 ימים אחרונים. הרשימה למטה')}
</div>

<h2 style="margin:6px 0 -6px">מה לשפר</h2>
<div class="ins">
<div class="card in"><h2>1. חוזרים אחרי שבוע</h2>
<b class="big">${I.retention == null ? '—' : I.retention + '%'}</b>
<p>מתוך ${fmt(I.retMeasured)} מכשירים שנכנסו לראשונה, חזרו תוך 7 ימים</p>
${table(I.cohorts, [c => 'שבוע ' + dmy(c.w), c => fmt(c.n) + ' חדשים', c => c.measured ? `${fmt(c.back)} חזרו (${share(c.back, c.measured)}%)` : 'מוקדם למדוד'])}
<div class="fix">אם נמוך: ההורה לא הבין מה הוא מרוויח בכניסה הראשונה, או שלא הפעיל התראות שיחזירו אותו.</div></div>

<div class="card in"><h2>2. איפה הורים חדשים נעצרים</h2>
<p class="sub">מכשירים שנכנסו ב־30 הימים האחרונים</p>
<div class="fn">${I.funnel.map(([l, n]) => `<div><span>${l}</span><i style="width:${I.funnel[0][1] ? Math.max(1, n / I.funnel[0][1] * 100) : 0}%"></i><em>${fmt(n)}${I.funnel[0][1] && n !== I.funnel[0][1] ? ` (${share(n, I.funnel[0][1])}%)` : ''}</em></div>`).join('')}</div>
<div class="fix">הירידה הגדולה ביותר בין שני שלבים היא המקום הראשון לשפר.</div></div>

<div class="card in"><h2>3. ימי משחק</h2>
<b class="big">${I.game.open == null ? '—' : I.game.open + '%'}</b>
<p>מתוך ${fmt(I.game.days)} ימי משחק של קבוצות במעקב ב־14 הימים האחרונים, באלה המשפחה פתחה את האפליקציה</p>
<p class="sub">באותם ימים לחצו ניווט או יומן: ${I.game.go == null ? '—' : I.game.go + '%'}</p>
<div class="fix">אם נמוך: האפליקציה עוד לא הרגל ביום משחק. כדאי לבדוק את תזכורת הערב ואת ההתראות.</div></div>

<div class="card in"><h2>4. כיבו התראות</h2>
<b class="big">${fmt(I.push.off)}</b>
<p>מכשירים שכיבו התראות ב־30 ימים${I.push.pct != null ? ` (${I.push.pct}% ממי שהיו לו התראות)` : ''}. התראות פעילות עכשיו: ${fmt(tot?.push)} (${pct(tot?.push, withTeam?.c)} ממי שבחר קבוצה)</p>
<div class="fix">אם עולה: ההתראות מעצבנות או מיותרות. כדאי לבדוק אילו נשלחות הכי הרבה (למטה).</div></div>

<div class="card in"><h2>5. מאיפה מגיעים</h2>
<b class="big">${I.source.pct == null ? '—' : I.source.pct + '%'}</b>
<p>מהמכשירים החדשים ב־30 ימים (${fmt(I.source.n)}) הגיעו מקישור שהורה אחר שלח</p>
<p class="sub">הצטרפו לקבוצה דרך קישור: ${fmt(I.source.joined)} מכשירים</p>
<div class="fix">אם נמוך: הורים לא מעבירים את האפליקציה הלאה. ההזמנה צריכה להיות בולטת יותר, או שהשיווק עושה את רוב העבודה.</div></div>

<div class="card in"><h2>פיצ'רים חדשים</h2>
<p>עוקבים אחרי קבוצת בוגרים: <b>${fmt(I.features.adultDevs)}</b> מכשירים</p>
<p>ראו אזהרה "באותה שעה" (30 ימים): <b>${fmt(I.features.clash)}</b> מכשירים</p></div>
</div>

<div class="card"><h2>פעילים בכל יום, 30 ימים</h2><div class="sub lg"><i style="background:var(--a)"></i>פעילים<i style="background:var(--b)"></i>חדשים</div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="פעילים יומיים">${bars}</svg></div>

<div class="cols">
<div class="card"><details><summary>כל הפעולות באפליקציה (30 ימים)</summary>${table(actions, [r => esc(ACTIONS[r.type] || r.type), r => fmt(r.devices) + ' מכשירים', r => fmt(r.times) + ' פעמים'])}</details></div>
<div class="card"><h2>התראות (30 ימים)</h2>${table(pushes, [r => ({ change: 'שינוי במשחק', result: 'תוצאה', eve: 'תזכורת ערב', practice: 'תזכורת אימון', report: 'תוצאה מדיווח הורה', ks_ask: 'בקשה לדווח (קט-סל)', test: 'בדיקה' }[r.kind] || r.kind), r => fmt(r.sent) + ' נשלחו', r => r.failed ? fmt(r.failed) + ' נכשלו' : ''])}</div>
</div>

<div class="cols">
<div class="card"><h2>הקבוצות שעוקבים אחריהן (${fmt(topTeams.length)})</h2>${(() => {
  const anyRes = topTeams.some(r => r.r > 0);
  const cols = [r => esc(r.team.split('|')[1]) + `<div class="sub">${esc(leagueName.get(r.team.split('|')[0]) || '')}</div>`, r => fmt(r.c) + ' עוקבים', ...(anyRes ? [r => r.r ? fmt(r.r) + ' רק תוצאות' : ''] : [])];
  return table(topTeams.slice(0, 15), cols) + (topTeams.length > 15 ? `<details style="margin-top:8px"><summary>הצגת כל הקבוצות (${fmt(topTeams.length)})</summary>${table(topTeams.slice(15), cols)}</details>` : '');
})()}</div>
<div class="card"><h2>לפי מועדון</h2><p class="sub">שמות שונים של אותו מועדון נספרים יחד</p>${table(sortMap(byClub).slice(0, 12), [r => esc(r[0]), r => fmt(r[1])])}
<h2 style="margin-top:14px">לפי גיל</h2>${table(sortMap(byAge), [r => esc(r[0]), r => fmt(r[1])])}</div>
</div>

<div class="card"><h2>מה ההורים כתבו</h2>
${fb.length ? `<div class="fbl">${fb.map(f => {
  const teams = JSON.parse(f.teams || '[]').map(k => k.split('|')[1]).join(', ');
  return `<div class="fbi"><div class="fbh"><span class="st ${f.topic === 'idea' ? 'ok' : 'bad'}">${esc(TOPIC[f.topic] || f.topic)}</span><span class="sub">${when(f.ts)}${f.source === 'my' ? ' · מתחתית "המשחקים שלי"' : ''} · ${esc(f.platform || '')}</span></div>
  <p>${esc(f.text)}</p>${f.contact ? `<div class="sub">לחזור אל: <b dir="ltr">${esc(f.contact)}</b></div>` : ''}${teams ? `<div class="sub">עוקבים אחרי: ${esc(teams)}</div>` : ''}${f.diag ? `<div class="sub">פרטים טכניים: ${esc(Object.entries(JSON.parse(f.diag)).map(([k, v]) => (DIAG[k] || k) + ': ' + v).join(' · '))}</div>` : ''}</div>`;
}).join('')}</div>` : '<p class="sub">עוד אין הודעות.</p>'}
</div>

<div class="card"><h2>סנכרון מול אתר האיגוד</h2>
${sync ? `<p><span class="st ${sync.ok ? 'ok' : 'bad'}">${sync.ok ? 'תקין' : 'נכשל'}</span> ריצה אחרונה ${when(sync.at)} (${esc(sync.source)})${sync.ok ? ` · ${fmt(sync.games)} משחקים · ${fmt(sync.changes)} שינויים · ${fmt(sync.pushed)} התראות` : `<br><span class="sub">${esc(sync.error)}</span>`}</p>` : '<p>עוד לא רץ סנכרון.</p>'}
${sync?.histAt ? `<p class="sub">משחקים קודמים בעונה (מקבצי האקסל של האיגוד): ${fmt(sync.histRows)} שורות מ־${fmt(sync.histLeagues)} ליגות${sync.histEmpty ? ` (ועוד ${fmt(sync.histEmpty)} ליגות שעדיין אין בהן משחקים)` : ''}, עודכן ${when(sync.histAt)}${sync.histFailed ? ` · ${fmt(sync.histFailed)} ליגות לא נטענו` : ''}</p>` : ''}
${sync?.histError ? `<p class="sub">${esc(sync.histError)}</p>` : ''}
<h2 style="margin-top:14px">שינויים שזוהו בלוח (7 ימים)</h2>${table(changes, [r => ({ moved: 'שעה או תאריך', venue: 'אולם', 'moved+venue': 'מועד ואולם', removed: 'ירד מהלוח', result: 'תוצאות שנכנסו' }[r.kind] || r.kind), r => fmt(r.c)])}
${lastOk && !sync?.ok ? `<p class="sub">סנכרון תקין אחרון: ${when(lastOk.at)}. האפליקציה ממשיכה להציג את הנתונים ממנו.</p>` : ''}
</div>
</main></body></html>`;
}
