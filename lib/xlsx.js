// A small reader for Excel .xlsx files (no extra packages needed).
// An .xlsx file is a zip of XML files: this unzips the parts it needs and
// reads cell values from one sheet. Good enough for supplier price lists;
// it doesn't evaluate formulas (it reads the last saved values).

const zlib = require('zlib');

function unzip(buf) {
  // Find the "end of central directory" record near the end of the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('This file is not a valid .xlsx spreadsheet.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('This .xlsx file looks damaged.');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    files[name] = { method, size, offset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: Object.keys(files),
    read(name) {
      const f = files[name];
      if (!f) return null;
      const start = f.offset + 30 + buf.readUInt16LE(f.offset + 26) + buf.readUInt16LE(f.offset + 28);
      const data = buf.subarray(start, start + f.size);
      if (f.method === 0) return data.toString('utf8');
      if (f.method === 8) return zlib.inflateRawSync(data).toString('utf8');
      throw new Error('This .xlsx file uses compression that can’t be read.');
    },
  };
}

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Text inside <t> elements (shared strings can be split into rich-text runs).
function textOf(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decode(m[1]);
  return out;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decode(m[1]) : null;
}

// "AB" -> 27 (0-based column index)
function columnIndex(ref) {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readWorkbook(buf) {
  const zip = unzip(buf);
  const workbook = zip.read('xl/workbook.xml');
  if (!workbook) throw new Error('This file is not a valid .xlsx spreadsheet.');
  const rels = zip.read('xl/_rels/workbook.xml.rels') || '';
  const targets = {};
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) targets[attr(m[0], 'Id')] = attr(m[0], 'Target');
  const sheets = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const target = targets[attr(m[0], 'r:id')] || '';
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    sheets.push({ name: attr(m[0], 'name'), path });
  }
  const sharedXml = zip.read('xl/sharedStrings.xml') || '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));

  return {
    sheetNames: sheets.map((s) => s.name),
    // Rows as arrays of cell values (strings or numbers), by column position.
    readSheet(name) {
      const sheet = sheets.find((s) => s.name.trim().toLowerCase() === String(name).trim().toLowerCase());
      if (!sheet) return null;
      const xml = zip.read(sheet.path) || '';
      const rows = [];
      for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
        const row = [];
        for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const tag = `<c${c[1]}>`;
          const inner = c[2] || '';
          const type = attr(tag, 't');
          const ref = attr(tag, 'r');
          const col = ref ? columnIndex(ref) : row.length;
          const v = inner.match(/<v>([\s\S]*?)<\/v>/);
          let value = null;
          if (type === 's') value = v ? shared[Number(v[1])] ?? '' : '';
          else if (type === 'inlineStr') value = textOf(inner);
          else if (type === 'str' || type === 'e') value = v ? decode(v[1]) : '';
          else if (type === 'b') value = v ? v[1] === '1' : false;
          else if (v) value = Number(v[1]);
          row[col] = value;
        }
        rows.push(row);
      }
      return rows;
    },
  };
}

module.exports = { readWorkbook };
