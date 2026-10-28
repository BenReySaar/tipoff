// Builds a calendar feed (iCalendar) for one family's teams. Phones re-read it on their own, so changes reach the calendar.

const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Israel local time (y,m,d,h,mi) -> UTC Date, correct across summer/winter time. */
export function ilToUtc(y, m, d, h, mi) {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let t = Date.UTC(y, m - 1, d, h, mi) - 2 * 3600e3;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
    const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    const want = Date.UTC(y, m - 1, d, h, mi);
    if (seen === want) break;
    t += want - seen;
  }
  return new Date(t);
}
const stamp = dt => dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 bytes must be folded (Hebrew letters are 2 bytes each).
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = []; let cur = '', n = 0, limit = 75;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (n + b > limit) { out.push(cur); cur = ''; n = 0; limit = 74; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** pack: the app pack. teamKeys: ["slug|name", ...]. host: e.g. "tipoff.co.il" */
export function icsFor(pack, teamKeys, host = 'tipoff') {
  const keyOf = ti => pack.lg[pack.tm[ti][1]][1] + '|' + pack.tm[ti][0];
  const want = new Set(teamKeys);
  const changed = new Map((pack.ch || []).map(c => [c[1], c]));
  const since = Date.now() - 30 * 864e5;
  const now = stamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TipOff//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:טיפ-אוף · משחקי הכדורסל', 'X-WR-TIMEZONE:Asia/Jerusalem', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
  for (const [id, d, lg, h, a, v, hs, as] of pack.g) {
    const hk = keyOf(h), ak = keyOf(a);
    if (!want.has(hk) && !want.has(ak)) continue;
    const start = ilToUtc(2000 + +d.slice(0, 2), +d.slice(2, 4), +d.slice(4, 6), +d.slice(6, 8), +d.slice(8, 10));
    if (start.getTime() < since) continue;
    const end = new Date(start.getTime() + 90 * 60e3);
    const ours = want.has(hk) ? h : a, opp = ours === h ? a : h;
    const home = ours === h;
    const both = want.has(hk) && want.has(ak);
    const title = both ? `🏀 ${pack.tm[h][0]} – ${pack.tm[a][0]}` : `🏀 ${pack.tm[ours][0]} נגד ${pack.tm[opp][0]}`;
    const desc = [pack.lg[lg][0]];
    if (!both) desc.push(`👕 ${home ? 'משחק בית' : 'משחק חוץ'} – לבדוק צבע גופייה`);
    if (hs != null) desc.push(`תוצאה: ${pack.tm[h][0]} ${hs} – ${as} ${pack.tm[a][0]}`);
    const c = changed.get(id);
    if (c) desc.push(`⚠️ המשחק עודכן (היה ב־${+c[3].slice(4, 6)}.${+c[3].slice(2, 4)} ${c[3].slice(6, 8)}:${c[3].slice(8, 10)}${c[4] !== pack.vn[v] ? ', ' + c[4] : ''})`);
    desc.push('לוח המשחקים מאתר איגוד הכדורסל. בכל סתירה, הקובע הוא פרסום האיגוד והודעת המאמן.');
    lines.push('BEGIN:VEVENT', `UID:${id}@${host}`, `DTSTAMP:${now}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
      `SUMMARY:${esc(title)}`, `LOCATION:${esc(pack.vn[v])}`, `DESCRIPTION:${esc(desc.join('\n'))}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export { DAYS };
