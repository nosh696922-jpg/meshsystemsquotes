// Product catalogues. Each manufacturer/supplier is a "source" with a sync()
// function in lib/catalogues/. To add another manufacturer later, add a file
// there and list it in SOURCES.

const store = require('./store');

const SOURCES = [require('./catalogues/ubiquiti')];

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const state = {}; // per-source { syncing, message, error } (this server only)

async function syncSource(id) {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw Object.assign(new Error(`Unknown catalogue: ${id}`), { status: 404 });
  if (state[id]?.syncing) return state[id].promise;

  state[id] = { syncing: true, message: 'Starting…', error: null };
  state[id].promise = source
    .sync({ onProgress: (msg) => (state[id].message = msg) })
    .then(async (data) => {
      await store.saveCatalogue(id, data);
      state[id] = { syncing: false, message: null, error: data.errors?.length ? data.errors.join('; ') : null };
      console.log(`[catalogue] ${source.name}: ${data.products.length} products`);
      return data;
    })
    .catch((err) => {
      state[id] = { syncing: false, message: null, error: err.message };
      console.error(`[catalogue] ${source.name} failed: ${err.message}`);
      throw err;
    });
  return state[id].promise;
}

// Refresh any catalogue that is missing or older than maxAge. Waits for the
// refresh to finish, which is what serverless hosts need.
async function refreshStale(maxAgeMs = MAX_AGE_MS) {
  const results = [];
  for (const source of SOURCES) {
    const data = await store.getCatalogue(source.id);
    const age = data ? Date.now() - new Date(data.fetchedAt).getTime() : Infinity;
    if (age > maxAgeMs) {
      try {
        const fresh = await syncSource(source.id);
        results.push({ id: source.id, refreshed: true, count: fresh.products.length });
      } catch (err) {
        results.push({ id: source.id, refreshed: false, error: err.message });
      }
    } else {
      results.push({ id: source.id, refreshed: false, ageHours: Math.round(age / 36e5) });
    }
  }
  return results;
}

async function sourcesInfo() {
  const info = [];
  for (const source of SOURCES) {
    const data = await store.getCatalogue(source.id);
    info.push({
      id: source.id,
      name: source.name,
      sourceUrl: data?.sourceUrl || null,
      fetchedAt: data?.fetchedAt || null,
      count: data?.products?.length || 0,
      syncing: Boolean(state[source.id]?.syncing),
      message: state[source.id]?.message || null,
      error: state[source.id]?.error || null,
    });
  }
  info.push({ id: 'custom', name: 'Our products', count: (await store.getCustomProducts()).length, custom: true });
  return info;
}

async function allProducts() {
  const products = [];
  for (const source of SOURCES) {
    let data = await store.getCatalogue(source.id);
    // First run (e.g. a fresh online install): fetch the catalogue now.
    if (!data) {
      try {
        data = await syncSource(source.id);
      } catch {
        data = null;
      }
    }
    if (data?.products) products.push(...data.products);
  }
  products.push(...(await store.getCustomProducts()));
  return products;
}

// ---- Our own (non-Ubiquiti) products ---------------------------------------

function cleanCustomProduct(input, id) {
  const price = Math.max(0, Math.round(Number(input.price) || 0));
  const cost = input.cost === '' || input.cost == null ? null : Math.max(0, Math.round(Number(input.cost) || 0));
  const sku = String(input.model || '').trim();
  const link = (s) => {
    const v = String(s || '').trim();
    return /^https?:\/\//i.test(v) ? v : null;
  };
  return {
    id,
    source: 'custom',
    manufacturer: String(input.manufacturer || '').trim() || 'Other',
    name: String(input.name || '').trim() || 'Untitled product',
    shortName: String(input.name || '').trim(),
    model: sku,
    description: String(input.description || '').trim(),
    category: String(input.category || '').trim() || 'Other',
    subCategory: '',
    image: link(input.image),
    imageLarge: link(input.image),
    url: link(input.url),
    price,
    cost,
    status: 'Available',
    defaultSku: sku,
    variants: [{ sku, displaySku: sku, label: '', price, surcharge: 0, status: 'Available' }],
    updatedAt: new Date().toISOString(),
  };
}

async function addCustomProduct(input) {
  const products = await store.getCustomProducts();
  const product = cleanCustomProduct(input, store.newId('custom-'));
  products.push(product);
  await store.saveCustomProducts(products);
  return product;
}

async function updateCustomProduct(id, input) {
  const products = await store.getCustomProducts();
  const index = products.findIndex((p) => p.id === id);
  if (index < 0) return null;
  products[index] = cleanCustomProduct(input, id);
  await store.saveCustomProducts(products);
  return products[index];
}

async function deleteCustomProduct(id) {
  await store.saveCustomProducts((await store.getCustomProducts()).filter((p) => p.id !== id));
}

module.exports = {
  syncSource,
  refreshStale,
  sourcesInfo,
  allProducts,
  addCustomProduct,
  updateCustomProduct,
  deleteCustomProduct,
};
