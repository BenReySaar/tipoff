// Practices a family entered: weekly ones, one-off ones, and changes to a single date (moved or cancelled).
// data = { list:[{id, team, days, start, end, place, remind, note, once?}], skips:{id:[date]}, moves:{id:{origDate:{date,start,end,place}}} }

export const dowOf = ymd => { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

/** The practices that actually happen on `date` (YYYY-MM-DD), with the time and place of that day. */
export function occOn(data, date) {
  const out = [];
  for (const p of data?.list || []) {
    const skips = data.skips?.[p.id] || [], moves = data.moves?.[p.id] || {};
    if (p.once) {
      if (p.once === date && !skips.includes(date)) out.push({ p, orig: date, start: p.start, end: p.end, place: p.place });
      continue;
    }
    if (p.days.includes(dowOf(date)) && !moves[date] && !skips.includes(date)) out.push({ p, orig: date, start: p.start, end: p.end, place: p.place });
    for (const [orig, m] of Object.entries(moves)) {
      if (m.date === date && !skips.includes(orig)) out.push({ p, orig, start: m.start, end: m.end ?? p.end, place: m.place ?? p.place });
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}
