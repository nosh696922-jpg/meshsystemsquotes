// Storage in Upstash Redis, used when the app runs online (e.g. on Vercel).
// Talks to Upstash's REST API with fetch, so no extra packages are needed.
//
// Connect "Upstash for Redis" to the Vercel project and these environment
// variables are added for you: KV_REST_API_URL and KV_REST_API_TOKEN
// (or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).

const zlib = require('zlib');

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const PREFIX = 'mesh:';
const QUOTE_SET = `${PREFIX}quotes`;
const COMPRESS_OVER = 100 * 1024; // compress big values such as the catalogue

async function command(...args) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Database returned ${res.status}`);
  }
  if (!res.ok || data.error) throw new Error(`Database error: ${data.error || res.status}`);
  return data.result;
}

function encode(value) {
  const json = JSON.stringify(value);
  if (json.length <= COMPRESS_OVER) return json;
  return `gz:${zlib.gzipSync(json).toString('base64')}`;
}

function decode(raw) {
  if (raw === null || raw === undefined) return null;
  if (raw.startsWith('gz:')) return JSON.parse(zlib.gunzipSync(Buffer.from(raw.slice(3), 'base64')).toString('utf8'));
  return JSON.parse(raw);
}

function quoteId(key) {
  return key.startsWith('quote:') ? key.slice(6) : null;
}

module.exports = {
  name: 'upstash',
  location: URL.replace(/^https?:\/\//, ''),

  configured() {
    return Boolean(URL && TOKEN);
  },

  async get(key) {
    return decode(await command('GET', PREFIX + key));
  },

  async set(key, value) {
    await command('SET', PREFIX + key, encode(value));
    const id = quoteId(key);
    if (id) await command('SADD', QUOTE_SET, id);
  },

  async del(key) {
    await command('DEL', PREFIX + key);
    const id = quoteId(key);
    if (id) await command('SREM', QUOTE_SET, id);
  },

  async listQuotes() {
    const ids = (await command('SMEMBERS', QUOTE_SET)) || [];
    if (!ids.length) return [];
    const values = await command('MGET', ...ids.map((id) => `${PREFIX}quote:${id}`));
    return values.map(decode).filter(Boolean);
  },

  async peekCounter() {
    return (Number(await command('GET', `${PREFIX}counter`)) || 0) + 1;
  },

  async takeCounter() {
    return Number(await command('INCR', `${PREFIX}counter`));
  },
};
