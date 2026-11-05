// Where the app keeps its data.
//
//   - Online (Upstash Redis configured): in the database.
//   - On your own computer: JSON files in the data/ folder.
//
// On Vercel the file system can't keep files, so if no database is connected
// the app says so instead of silently losing quotes.

const crypto = require('crypto');
const { defaultSettings } = require('./defaults');
const fileBackend = require('./storage/file');
const redisBackend = require('./storage/redis');

const ON_VERCEL = Boolean(process.env.VERCEL);
const backend = redisBackend.configured() ? redisBackend : ON_VERCEL ? null : fileBackend;

function storageError() {
  return Object.assign(
    new Error('No database connected. In Vercel, open this project → Storage, connect “Upstash for Redis”, then redeploy.'),
    { status: 503, setup: 'storage' },
  );
}

function db() {
  if (!backend) throw storageError();
  return backend;
}

function info() {
  return { ready: Boolean(backend), name: backend?.name || null, location: backend?.location || null };
}

function newId(prefix = '', bytes = 6) {
  return prefix + crypto.randomBytes(bytes).toString('hex');
}

function safeId(id) {
  if (!/^[a-z0-9_-]+$/i.test(String(id))) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return id;
}

// ---- Settings -------------------------------------------------------------

async function getSettings() {
  const saved = await db().get('settings');
  const defaults = defaultSettings();
  const settings = saved
    ? {
        ...defaults,
        ...saved,
        company: { ...defaults.company, ...(saved.company || {}) },
        display: { ...defaults.display, ...(saved.display || {}) },
      }
    : defaults;
  settings.nextQuoteNumber = await db().peekCounter();
  return settings;
}

async function saveSettings(input) {
  const current = await getSettings();
  const next = { ...current, ...input };
  delete next.nextQuoteNumber; // kept separately so two people can't get the same number
  await db().set('settings', next);
  return getSettings();
}

// The next new quote gets number 0001 again.
async function resetQuoteNumbers() {
  await db().resetCounter(1);
}

async function takeQuoteNumber() {
  const settings = await getSettings();
  const n = await db().takeCounter();
  return `${settings.quotePrefix || ''}${String(n).padStart(4, '0')}`;
}

// ---- Quotes ---------------------------------------------------------------

async function listQuotes() {
  return db().listQuotes();
}

async function getQuote(id) {
  return db().get(`quote:${safeId(id)}`);
}

async function saveQuote(quote) {
  await db().set(`quote:${safeId(quote.id)}`, quote);
  return quote;
}

async function deleteQuote(id) {
  await db().del(`quote:${safeId(id)}`);
  await db().del(`activity:${safeId(id)}`);
  await db().del(`revisions:${safeId(id)}`);
}

// What clients did with a proposal link (views, replies).
async function getActivity(id) {
  return db().get(`activity:${safeId(id)}`);
}

async function saveActivity(id, activity) {
  await db().set(`activity:${safeId(id)}`, activity);
}

async function listActivity(ids) {
  return db().getMany(ids.map((id) => `activity:${safeId(id)}`));
}

// Saved versions of a quote, oldest first.
async function getRevisions(id) {
  return (await db().get(`revisions:${safeId(id)}`)) || [];
}

async function saveRevisions(id, revisions) {
  await db().set(`revisions:${safeId(id)}`, revisions);
}

// Kits: groups of items saved to reuse on other quotes.
async function getKits() {
  return (await db().get('kits'))?.kits || [];
}

async function saveKits(kits) {
  await db().set('kits', { kits });
}

// ---- Catalogues -----------------------------------------------------------

async function getCatalogue(id) {
  return db().get(`catalogue:${safeId(id)}`);
}

async function saveCatalogue(id, data) {
  await db().set(`catalogue:${safeId(id)}`, data);
}

async function getCustomProducts() {
  return (await getCatalogue('custom'))?.products || [];
}

async function saveCustomProducts(products) {
  await saveCatalogue('custom', { products });
}

module.exports = {
  ON_VERCEL,
  info,
  newId,
  getSettings,
  saveSettings,
  takeQuoteNumber,
  resetQuoteNumbers,
  listQuotes,
  getQuote,
  saveQuote,
  deleteQuote,
  getActivity,
  saveActivity,
  listActivity,
  getRevisions,
  saveRevisions,
  getKits,
  saveKits,
  getCatalogue,
  saveCatalogue,
  getCustomProducts,
  saveCustomProducts,
};
