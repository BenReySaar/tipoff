// Minimal .xlsx reader for the association's "יצוא לאקסל" files: first sheet → array of rows (strings / numbers).
// Uses only what Workers have built in (DecompressionStream), no libraries.

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

/** zip bytes → Map(name → () => Promise<string>) */
function unzip(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const n = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const files = new Map();
  const td = new TextDecoder();
  for (let k = 0; k < n; k++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('bad zip directory');
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), off = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
    files.set(name, async () => {
      const start = off + 30 + u16(b, off + 26) + u16(b, off + 28);
      const data = b.subarray(start, start + csize);
      return td.decode(method === 0 ? data : await inflateRaw(data));
    });
    p += 46 + nlen + elen + clen;
  }
  return files;
}

const unxml = s => s.replace(/&(lt|gt|quot|apos|amp|#\d+|#x[0-9a-f]+);/gi, (m, e) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : e === 'apos' ? "'" : e === 'amp' ? '&' :
  String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)));
const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** .xlsx bytes → rows of the first sheet */
export async function readXlsx(buf) {
  const files = unzip(buf);
  const shared = [];
  if (files.has('xl/sharedStrings.xml')) {
    const xml = await files.get('xl/sharedStrings.xml')();
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unxml([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join('')));
  }
  const sheetName = [...files.keys()].filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0];
  if (!sheetName) throw new Error('no sheet');
  const xml = await files.get(sheetName)();
  const rows = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      const type = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = null;
      if (type === 's') val = shared[+v] ?? null;
      else if (type === 'inlineStr') val = unxml([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => m[1]).join(''));
      else if (type === 'str' || type === 'b') val = v != null ? unxml(v) : null;
      else if (v != null) val = Number(v);
      row[ref ? colIdx(ref) : row.length] = val;
    }
    rows.push(row);
  }
  return rows;
}
