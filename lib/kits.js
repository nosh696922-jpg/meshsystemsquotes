// Kits: a group of items (with their labour) saved under a name, such as
// "Standard WiFi room" or "Door entry package", to add to any quote in one go.

const store = require('./store');

const MAX_ITEMS = 200;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function str(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

function pence(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function optionalPence(v) {
  return v === null || v === undefined || v === '' ? null : pence(v);
}

function link(v) {
  const s = str(v, 1000);
  return /^https?:\/\//i.test(s) ? s : null;
}

function hours(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function cleanItem(i) {
  if (i?.kind === 'labour') {
    return { kind: 'labour', type: str(i.type, 60), hours: hours(i.hours), description: str(i.description, 500) };
  }
  const discount = Number(i?.discount);
  return {
    kind: 'product',
    source: str(i?.source, 30) || 'manual',
    productId: i?.productId ? str(i.productId, 120) : null,
    manufacturer: str(i?.manufacturer, 120),
    name: str(i?.name, 300) || 'Item',
    model: str(i?.model, 120),
    sku: str(i?.sku, 120),
    variantLabel: str(i?.variantLabel, 200),
    description: str(i?.description, 3000),
    image: link(i?.image),
    url: link(i?.url),
    basePrice: pence(i?.basePrice),
    surcharge: pence(i?.surcharge),
    costPrice: optionalPence(i?.costPrice),
    priceOverride: optionalPence(i?.priceOverride),
    discount: Number.isFinite(discount) ? Math.min(100, Math.max(0, discount)) : 0,
    qty: Math.max(1, Math.round(Number(i?.qty) || 1)),
    labour: (Array.isArray(i?.labour) ? i.labour : []).slice(0, 20).map((l) => ({ type: str(l?.type, 60), hours: hours(l?.hours) })),
  };
}

function clean(input, existing = {}) {
  const items = Array.isArray(input.items) ? input.items : existing.items || [];
  if (!items.length) throw httpError(400, 'A kit needs at least one item.');
  if (items.length > MAX_ITEMS) throw httpError(400, `A kit can have up to ${MAX_ITEMS} items.`);
  const now = new Date().toISOString();
  return {
    id: existing.id,
    name: str(input.name ?? existing.name, 120) || 'Untitled kit',
    description: str(input.description ?? existing.description, 1000),
    items: Array.isArray(input.items) ? items.map(cleanItem) : existing.items,
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

async function list() {
  return store.getKits();
}

async function add(input) {
  const kits = await store.getKits();
  const kit = clean(input || {}, { id: store.newId('kit-') });
  kits.push(kit);
  await store.saveKits(kits);
  return kit;
}

async function update(id, input) {
  const kits = await store.getKits();
  const index = kits.findIndex((k) => k.id === id);
  if (index < 0) throw httpError(404, 'Kit not found');
  kits[index] = clean(input || {}, kits[index]);
  await store.saveKits(kits);
  return kits[index];
}

async function remove(id) {
  await store.saveKits((await store.getKits()).filter((k) => k.id !== id));
}

module.exports = { list, add, update, remove };
