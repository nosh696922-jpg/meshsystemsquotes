// Storage in JSON files under data/. Used when running on your own computer.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

function fileFor(key) {
  const [kind, id] = key.split(':');
  if (kind === 'settings') return path.join(DATA_DIR, 'settings.json');
  if (kind === 'counter') return path.join(DATA_DIR, 'counter.json');
  if (kind === 'quote') return path.join(DATA_DIR, 'quotes', `${id}.json`);
  if (kind === 'catalogue') return path.join(DATA_DIR, 'catalogues', `${id}.json`);
  throw new Error(`Unknown storage key: ${key}`);
}

function read(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Write to a temp file first, then rename, so a crash never leaves half a file.
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = {
  name: 'files',
  location: DATA_DIR,

  async get(key) {
    return read(fileFor(key));
  },

  async set(key, value) {
    write(fileFor(key), value);
  },

  async del(key) {
    fs.rmSync(fileFor(key), { force: true });
  },

  async listQuotes() {
    const dir = path.join(DATA_DIR, 'quotes');
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => read(path.join(dir, f)))
      .filter(Boolean);
  },

  // Next quote number. Older installs kept it in settings.json.
  async peekCounter() {
    const counter = read(fileFor('counter'));
    if (counter) return counter.next;
    return read(fileFor('settings'))?.nextQuoteNumber || 1;
  },

  async takeCounter() {
    const n = await this.peekCounter();
    write(fileFor('counter'), { next: n + 1 });
    return n;
  },
};
