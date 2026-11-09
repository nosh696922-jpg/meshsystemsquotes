// Product catalogues. Each manufacturer/supplier is a "source" in
// lib/catalogues/. Three kinds:
//   - SOURCES are read from the maker's website by sync(), and refresh daily.
//   - IMPORTED come from a price list file you upload (importFile()).
//   - LIVE are searched through the supplier's API as you type (Habitech),
//     because they're too big to copy in.
// To add another manufacturer, add a file there and list it below.

const store = require('./store');

const SOURCES = [require('./catalogues/ubiquiti'), require('./catalogues/sonos')];
const IMPORTED = [require('./catalogues/crestron')];
const LIVE = [require('./catalogues/habitech')];

function liveSource(id) {
  const source = LIVE.find((s) => s.id === id);
  if (!source) throw Object.assign(new Error(`Unknown catalogue: ${id}`), { status: 404 });
  return source;
}

const liveSearch = (id, q, offset) => liveSource(id).search(q, offset);
const liveProduct = (id, sku) => liveSource(id).product(sku);
const livePrices = (id, skus) => liveSource(id).prices(skus);

// ---- Copies of live catalogues, for browsing ---------------------------------
// The copy is saved as catalogue "<id>"; a copy in progress as "<id>-job".

const jobKey = (id) => `${id}-job`;
const running = {}; // this server: id → promise of the step in progress

function copyInfo(copy, job) {
  return {
    copy: copy?.rows ? { count: copy.rows.length, fetchedAt: copy.fetchedAt, refreshedAt: copy.refreshedAt || copy.fetchedAt } : null,
    job: job && !job.done
      ? { categoriesDone: job.index, categoriesTotal: job.categories.length, products: Object.keys(job.rows || {}).length, startedAt: job.startedAt }
      : null,
  };
}

async function liveStatus(id) {
  const source = liveSource(id);
  const [status, copy, job] = await Promise.all([source.status(), store.getCatalogue(id), store.getCatalogue(jobKey(id))]);
  return { ...status, ...copyInfo(copy, job), copying: Boolean(running[id]) };
}

// One step of copying: carries on a copy in progress (or starts one when
// there's no copy yet, or `restart` is set), else refreshes the copy we have.
// Stops at `deadline` and saves where it got to.
async function copyLive(id, { deadline = Infinity, restart = false, refresh = true } = {}) {
  const source = liveSource(id);
  if (!source.configured()) throw Object.assign(new Error(`${source.label} isn’t connected: add its API key first.`), { status: 503 });
  if (running[id]) return running[id];
  running[id] = (async () => {
    const copy = await store.getCatalogue(id);
    let job = await store.getCatalogue(jobKey(id));
    // Another server may be part-way through a step: leave it to finish.
    if (job?.lockedUntil && new Date(job.lockedUntil) > new Date() && !restart) return { busy: true, ...copyInfo(copy, job) };
    if (restart || (!copy && !job)) job = await source.startCopy();
    if (job) {
      job.lockedUntil = new Date(Math.min(deadline, Date.now() + 10 * 60e3) + 5000).toISOString();
      await store.saveCatalogue(jobKey(id), job);
      job = await source.continueCopy(job, deadline);
      if (job.done) {
        const finished = source.finishCopy(job);
        await store.saveCatalogue(id, finished);
        await store.deleteCatalogue(jobKey(id));
        console.log(`[catalogue] ${source.name}: copied ${finished.rows.length} products`);
        return copyInfo(finished, null);
      }
      job.lockedUntil = null;
      await store.saveCatalogue(jobKey(id), job);
      return copyInfo(copy, job);
    }
    if (!refresh) return copyInfo(copy, null);
    const fresh = await source.refreshCopy(copy, deadline);
    await store.saveCatalogue(id, fresh);
    console.log(`[catalogue] ${source.name}: refreshed ${fresh.rows.length} products`);
    return copyInfo(fresh, null);
  })().finally(() => delete running[id]);
  return running[id];
}

async function liveCopy(id) {
  liveSource(id);
  const copy = await store.getCatalogue(id);
  return copy?.rows ? { rows: copy.rows, imageBase: copy.imageBase, fetchedAt: copy.fetchedAt, refreshedAt: copy.refreshedAt || copy.fetchedAt } : { rows: null };
}

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const state = {}; // per-source { syncing, message, error } (this server only)

async function syncSource(id) {
  const source = SOURCES.find((s) => s.id === id);
  if (!source) throw Object.assign(new Error(`Unknown catalogue: ${id}`), { status: 404 });
  if (state[id]?.syncing) return state[id].promise;

  state[id] = { syncing: true, message: 'Starting…', error: null };
  state[id].promise = store
    .getCatalogue(id)
    .catch(() => null)
    .then((previous) => source.sync({ onProgress: (msg) => (state[id].message = msg), previous }))
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
// refresh to finish, which is what serverless hosts need. Live catalogues'
// copies use whatever time is left before `deadline`.
async function refreshStale(maxAgeMs = MAX_AGE_MS, { deadline = Infinity } = {}) {
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
  for (const source of LIVE) {
    if (!source.configured()) continue;
    try {
      const [copy, job] = await Promise.all([store.getCatalogue(source.id), store.getCatalogue(jobKey(source.id))]);
      const age = copy ? Date.now() - new Date(copy.refreshedAt || copy.fetchedAt).getTime() : Infinity;
      if (job || !copy || age > maxAgeMs) {
        const info = await copyLive(source.id, { deadline });
        results.push({ id: source.id, refreshed: true, ...info });
      } else {
        results.push({ id: source.id, refreshed: false, ageHours: Math.round(age / 36e5) });
      }
    } catch (err) {
      console.error(`[catalogue] ${source.name} copy failed: ${err.message}`);
      results.push({ id: source.id, refreshed: false, error: err.message });
    }
  }
  return results;
}

// Import a supplier's price list file (e.g. Crestron's .xlsx).
async function importSource(id, buffer, fileName) {
  const source = IMPORTED.find((s) => s.id === id);
  if (!source) throw Object.assign(new Error(`Unknown price list: ${id}`), { status: 404 });
  if (!buffer || !buffer.length) throw Object.assign(new Error('Choose a price list file to import.'), { status: 400 });
  const data = source.importFile(buffer, fileName);
  await store.saveCatalogue(id, data);
  console.log(`[catalogue] ${source.name}: imported ${data.products.length} products`);
  return { count: data.products.length, skipped: data.skipped || [], priceListDate: data.priceListDate || null };
}

async function sourcesInfo() {
  const info = [];
  for (const source of SOURCES) {
    const data = await store.getCatalogue(source.id);
    info.push({
      id: source.id,
      kind: 'web',
      name: source.name,
      label: source.label || source.name,
      tabName: source.tabName || source.name,
      site: source.site || null,
      sourceUrl: data?.sourceUrl || null,
      fetchedAt: data?.fetchedAt || null,
      count: data?.products?.length || 0,
      syncing: Boolean(state[source.id]?.syncing),
      message: state[source.id]?.message || null,
      error: state[source.id]?.error || null,
    });
  }
  for (const source of IMPORTED) {
    const data = await store.getCatalogue(source.id);
    info.push({
      id: source.id,
      kind: 'import',
      name: source.name,
      label: source.label || source.name,
      tabName: source.tabName || source.name,
      fetchedAt: data?.fetchedAt || null, // when it was imported
      fileName: data?.fileName || null,
      priceListDate: data?.priceListDate || null,
      skipped: data?.skipped?.length || 0,
      count: data?.products?.length || 0,
    });
  }
  for (const source of LIVE) {
    info.push({
      id: source.id,
      kind: 'live',
      name: source.name,
      label: source.label || source.name,
      tabName: source.tabName || source.name,
      site: source.site || null,
      configured: source.configured(),
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
  for (const source of IMPORTED) {
    const data = await store.getCatalogue(source.id);
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
  importSource,
  liveSearch,
  liveProduct,
  livePrices,
  liveStatus,
  liveCopy,
  copyLive,
  refreshStale,
  sourcesInfo,
  allProducts,
  addCustomProduct,
  updateCustomProduct,
  deleteCustomProduct,
};
