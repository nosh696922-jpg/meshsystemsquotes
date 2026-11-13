// Habitech (UK distributor), read live from Habitech's API with our trade
// account's key. Habitech lists 10,000+ products, too many to copy in every
// night, so the product picker searches Habitech as you type, and a quote
// checks its Habitech lines' prices in one go when it opens.
//
// Needs HABITECH_API_KEY: in Vercel → Settings → Environment Variables, or in
// the .env file on your own computer. The key stays on the server; browsers
// never see it. Habitech's developer guide (API-GUIDE.md, from Charles Plumb)
// documents the API.
//
// Habitech prices are ex VAT, in pounds: `price` is our trade price (what we
// pay) and `srp` the suggested retail price (what we sell at). Habitech leaves
// `srp` out when it is the same as the trade price.

const BASE = 'https://mcp.habitech.co.uk';
const SITE = 'https://www.habitech.co.uk';
const PAGE_SIZE = 40;
const BULK_MAX = 250; // SKUs per bulk price request (Habitech's limit)
const TIMEOUT_MS = 15000;

const apiKey = () => (process.env.HABITECH_API_KEY || '').trim();
const configured = () => Boolean(apiKey());

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

// Our server answers with 502/503 for Habitech problems (never 401, which
// would send the team to the sign-in page).
async function request(path, body) {
  if (!configured()) {
    throw fail(503, 'The Habitech API key isn’t set up yet. Add HABITECH_API_KEY in Vercel → Settings → Environment Variables (or in the .env file on your own computer).');
  }
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${apiKey()}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'it took too long to answer' : 'no connection';
    throw fail(502, `Couldn’t reach Habitech (${why}). Try again in a moment.`);
  }
  const data = await res.json().catch(() => null);
  if (res.ok) return { data, syncedAt: res.headers.get('x-data-synced-at') || data?.synced_at || null };
  if (res.status === 404) return { data: null, notFound: true };
  const said = data?.error ? `: ${data.error}` : '';
  if (res.status === 401) throw fail(502, 'Habitech didn’t accept the API key. It may have been replaced or switched off, so ask Habitech for a new one.');
  if (res.status === 403) throw fail(502, `Habitech refused the request${said}.`);
  if (res.status === 429) {
    throw Object.assign(fail(503, 'Too many Habitech searches in one minute. Wait a few seconds and try again.'), {
      retryAfter: Number(res.headers.get('retry-after')) || 10,
    });
  }
  throw fail(502, `Habitech returned an error (${res.status})${said}.`);
}

const pence = (pounds) => (pounds === null || pounds === undefined || pounds === '' ? null : Math.round(Number(pounds) * 100));
const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// One orderable SKU: our selling price is the SRP (or the trade price when
// Habitech gives no separate SRP), and our cost is the trade price.
function option(row, label = '') {
  const noPricing = row.no_pricing === true || row.error === 'no_pricing';
  let cost = noPricing ? null : pence(row.price);
  const srp = pence(row.srp);
  if (cost === 0 && !srp) cost = null; // placeholder items with no real price
  const priced = cost !== null;
  return {
    sku: row.sku,
    displaySku: row.sku,
    label,
    price: priced ? (srp || cost) : 0,
    cost,
    surcharge: 0,
    status: priced ? 'Available' : 'NoPrice',
    noSrp: priced && !srp,
    stock: row.stock_status || row.status || null, // in_stock, low_stock, out_of_stock
    qty: row.quantity_available ?? null,
    restockDate: row.restock_date || null,
  };
}

// "SCP CAT6 cable, Blue" under "SCP CAT6 cable" → "Blue".
function optionLabel(parentName, childName) {
  const a = tidy(parentName).split(' ');
  const b = tidy(childName).split(' ');
  let i = 0;
  while (i < a.length && i < b.length && a[i].toLowerCase() === b[i].toLowerCase()) i++;
  return b.slice(i).join(' ').replace(/^[,.:;\-–\s]+/, '') || tidy(childName);
}

function toProduct(row) {
  const name = tidy(row.name);
  const variants = Array.isArray(row.variants) && row.variants.length
    ? row.variants.map((v) => option(v, optionLabel(name, v.name || v.sku)))
    : [option(row)];
  const first = variants.find((v) => v.status === 'Available') || variants[0];
  const images = Array.isArray(row.image_url) ? row.image_url : row.image_url ? [row.image_url] : [];
  return {
    id: `habitech:${row.sku}`,
    source: 'habitech',
    manufacturer: tidy(row.brand) || 'Habitech',
    name,
    shortName: name,
    model: tidy(row.mpn) || row.sku,
    description: tidy(row.sales_description || row.description),
    category: tidy(row.category_path),
    subCategory: '',
    image: images[0] || null,
    imageLarge: images[0] || null,
    url: row.website_url ? `${SITE}/${String(row.website_url).replace(/^\/+/, '')}` : null,
    price: first.price,
    cost: first.cost,
    status: row.item_status === 'Discontinued' ? 'Discontinued' : first.status,
    replacementSku: row.replacement_sku || null,
    defaultSku: first.sku,
    variants,
    // Products sold in options (e.g. cable colours) need their options loaded.
    hasOptions: Boolean(row.is_configurable_parent) && !(Array.isArray(row.variants) && row.variants.length),
    optionCount: row.variant_count || 0,
  };
}

// Search by name, brand, part code or manufacturer part number.
async function search(query, offset = 0) {
  const q = tidy(query);
  if (q.length < 2) return { products: [], total: 0, hasMore: false };
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const { data } = await request(`/v1/products?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${start}`);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return {
    products: rows.filter((r) => r && r.sku).map(toProduct),
    total: data?.pagination?.total ?? rows.length,
    hasMore: Boolean(data?.pagination?.has_more),
    offset: start,
    fuzzy: Boolean(data?.fuzzy),
    didYouMean: data?.did_you_mean || null,
  };
}

// Full detail for one product, including the options of a product sold in options.
async function product(sku) {
  const { data, notFound } = await request(`/v1/products/${encodeURIComponent(String(sku || ''))}`);
  if (notFound || !data?.data) throw fail(404, `Habitech doesn’t list ${sku} any more.`);
  return toProduct(data.data);
}

// Today's price, cost and stock for many SKUs: { [sku]: option }.
async function prices(skuList) {
  const skus = [...new Set((Array.isArray(skuList) ? skuList : []).map((s) => String(s || '').trim()).filter(Boolean))].slice(0, 1000);
  const out = {};
  for (let i = 0; i < skus.length; i += BULK_MAX) {
    const chunk = skus.slice(i, i + BULK_MAX);
    const [priced, stock] = await Promise.all([
      request('/v1/pricing/bulk', { skus: chunk }),
      request('/v1/availability', { skus: chunk }).catch(() => ({ data: null })), // stock is a bonus
    ]);
    const stockBySku = new Map((stock.data?.data || []).map((r) => [String(r.sku).toLowerCase(), r]));
    for (const row of priced.data?.data || []) {
      if (!row?.sku || row.error === 'not_found') continue;
      const s = stockBySku.get(String(row.sku).toLowerCase()) || {};
      const requested = chunk.find((c) => c.toLowerCase() === String(row.sku).toLowerCase()) || row.sku;
      out[requested] = option({ ...row, stock_status: s.status, quantity_available: s.quantity_available, restock_date: s.restock_date });
      if (s.is_active === false) out[requested].discontinued = true;
    }
  }
  return out;
}

// How many products we have prices for, and when Habitech last updated them.
// Kept for an hour, so opening the Products page doesn't ask Habitech each time.
let statusCache = null;
async function status() {
  if (!configured()) return { configured: false };
  if (statusCache && Date.now() - statusCache.at < (statusCache.error ? 60e3 : 60 * 60e3)) return statusCache.value;
  let value;
  try {
    const { data, syncedAt } = await request('/v1/pricing?limit=1');
    value = { configured: true, count: data?.pagination?.total ?? null, syncedAt, error: null };
  } catch (err) {
    value = { configured: true, count: null, syncedAt: null, error: err.message };
  }
  statusCache = { at: Date.now(), value, error: Boolean(value.error) };
  return value;
}

// ---- A copy of the whole catalogue, for browsing ---------------------------------
// Habitech's API has no "list everything", so the first copy walks every
// category: about 800 requests, roughly 3 minutes at Habitech's limit of 300 a
// minute. It runs in chunks that each fit in one short server request
// (Vercel stops a request after a minute) and carries on where it left off.
// After that, a nightly refresh fetches only what changed, plus today's prices
// and stock: about 70 requests.
//
// Products are kept as compact rows to keep the copy small:
//   [sku, name, brand, mpn, category, image, cost, srp, stock, qty, description]
// with money in pence, image without IMAGE_BASE, stock as i / l / o (in, low,
// out), and description only when it says more than the name.

const IMAGE_BASE = `${SITE}/site/product-images/`;
const PER_SECOND = 4; // under Habitech's 300 a minute, leaving room for searches
const STOCK_CODE = { in_stock: 'i', low_stock: 'l', out_of_stock: 'o' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pacer(perSecond) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + 1000 / perSecond;
    if (at > now) await sleep(at - now);
  };
}

// A paced request that waits and tries again if Habitech says "slow down",
// unless that would run past the deadline.
async function pacedRequest(pace, path, body, deadline = Infinity) {
  for (let attempt = 0; ; attempt++) {
    await pace();
    try {
      return await request(path, body);
    } catch (err) {
      if (!err.retryAfter || attempt >= 3 || Date.now() + err.retryAfter * 1000 + 3000 > deadline) throw err;
      await sleep(err.retryAfter * 1000);
    }
  }
}

// One product from a search or category listing, as a compact row (or null
// when Habitech has no trade price for it on our account).
function rowFrom(r) {
  const o = option(r);
  if (o.status !== 'Available') return null;
  const name = tidy(r.name);
  if (/^do not display/i.test(name)) return null; // Habitech hides these on its own website
  const description = tidy(r.sales_description);
  let image = (Array.isArray(r.image_url) ? r.image_url[0] : r.image_url) || '';
  if (image.startsWith(IMAGE_BASE)) image = image.slice(IMAGE_BASE.length);
  return [
    r.sku,
    name,
    tidy(r.brand),
    tidy(r.mpn),
    tidy(r.category_path),
    image,
    o.cost,
    o.noSrp ? null : o.price,
    STOCK_CODE[r.stock_status] || '',
    r.quantity_available ?? null,
    description && description.toLowerCase() !== name.toLowerCase() ? description : '',
  ];
}

const R = { sku: 0, name: 1, brand: 2, cost: 6, srp: 7, stock: 8, qty: 9 };

function flattenCategories(nodes, out = []) {
  for (const n of nodes || []) {
    if (n && n.id != null) out.push(n.id);
    flattenCategories(n.children, out);
  }
  return out;
}

// Start a fresh copy: the list of categories to walk.
async function startCopy() {
  const { data, syncedAt } = await request('/v1/categories');
  const categories = [...new Set(flattenCategories(data?.data))];
  if (!categories.length) throw fail(502, 'Habitech returned no categories to copy.');
  return { startedAt: new Date().toISOString(), cursor: syncedAt || new Date().toISOString(), categories, index: 0, offset: 0, rows: {}, requests: 1 };
}

// Run paced tasks a few at a time (so slow replies don't hold everything up)
// until they're all done or the deadline is near. Returns true if all ran.
async function runPaced(tasks, deadline, concurrency = 3) {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (next < tasks.length && !stopped) {
      if (Date.now() + 3000 > deadline) {
        stopped = true;
        return;
      }
      try {
        await tasks[next++]();
      } catch (err) {
        if (!err.retryAfter) throw err;
        stopped = true; // Habitech wants a pause: stop here, the next run carries on
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return !stopped && next >= tasks.length;
}

// Full details of one SKU, as a compact row (a search finds the exact SKU).
async function exactRow(pace, sku, deadline) {
  const { data } = await pacedRequest(pace, `/v1/products?q=${encodeURIComponent(sku)}&limit=5`, undefined, deadline);
  const hit = (data?.data || []).find((r) => String(r.sku).toLowerCase() === String(sku).toLowerCase());
  return hit ? rowFrom(hit) : null;
}

// Walk categories until the deadline, then pick up the few priced products
// that aren't in any category. Returns the job, with done: true at the end.
async function continueCopy(job, deadline = Infinity) {
  const pace = pacer(PER_SECOND);
  try {
    while (job.index < job.categories.length) {
      if (Date.now() + 3000 > deadline) return job;
      const id = job.categories[job.index];
      const { data } = await pacedRequest(pace, `/v1/products?category=${encodeURIComponent(id)}&limit=100&offset=${job.offset}`, undefined, deadline);
      job.requests++;
      for (const r of data?.data || []) {
        const row = r && r.sku ? rowFrom(r) : null;
        if (row) job.rows[row[R.sku]] = row;
      }
      if (data?.pagination?.has_more) job.offset += 100;
      else {
        job.index++;
        job.offset = 0;
      }
    }

    // Habitech's price list has every SKU we can buy: anything priced that the
    // walk didn't find (about 15) is fetched one by one.
    if (!job.missing) {
      job.bookOffset ||= 0;
      job.bookMissing ||= [];
      for (;;) {
        if (Date.now() + 3000 > deadline) return job;
        const { data } = await pacedRequest(pace, `/v1/pricing?limit=500&offset=${job.bookOffset}`, undefined, deadline);
        job.requests++;
        for (const p of data?.data || []) if (Number(p.price) > 0 && !job.rows[p.sku]) job.bookMissing.push(p.sku);
        if (!data?.pagination?.has_more) break;
        job.bookOffset += 500;
      }
      job.missing = job.bookMissing.slice(0, 300);
      job.missingIndex = 0;
      delete job.bookMissing;
    }
    while (job.missingIndex < job.missing.length) {
      if (Date.now() + 3000 > deadline) return job;
      const row = await exactRow(pace, job.missing[job.missingIndex], deadline);
      job.requests++;
      if (row) job.rows[row[R.sku]] = row;
      job.missingIndex++;
    }
  } catch (err) {
    if (err.retryAfter) return job; // Habitech wants a pause: keep what we have, carry on next time
    throw err;
  }
  job.done = true;
  return job;
}

// The finished copy, ready to save.
function finishCopy(job) {
  const rows = Object.values(job.rows).sort((a, b) => a[R.name].localeCompare(b[R.name]));
  const now = new Date().toISOString();
  return { fetchedAt: now, refreshedAt: now, cursor: job.cursor, imageBase: IMAGE_BASE, rows };
}

// Nightly: products added, changed or withdrawn since last time, then today's
// prices and stock for everything. Stops at the deadline; whatever it has
// updated so far is kept, and the next run starts again from the top.
async function refreshCopy(copy, deadline = Infinity) {
  const pace = pacer(PER_SECOND);
  const bySku = new Map(copy.rows.filter((r) => !/^do not display/i.test(r[R.name])).map((r) => [r[R.sku], r]));
  const timeLeft = () => Date.now() + 3000 < deadline;
  const out = { ...copy };

  // 1. What changed since the last copy (thin rows: sku, name, brand, is_active).
  let cursor = copy.cursor;
  const added = [];
  for (let offset = 0; timeLeft(); offset += 100) {
    const { data, syncedAt } = await pacedRequest(pace, `/v1/products?modified_since=${encodeURIComponent(copy.cursor)}&limit=100&offset=${offset}`, undefined, deadline);
    if (offset === 0 && syncedAt) cursor = syncedAt;
    for (const d of data?.data || []) {
      const row = bySku.get(d.sku);
      if (d.is_active === false) bySku.delete(d.sku);
      else if (row) {
        if (d.name) row[R.name] = tidy(d.name);
        if (d.brand) row[R.brand] = tidy(d.brand);
      } else added.push(d.sku);
    }
    if (!data?.pagination?.has_more || offset > 3000) break; // a huge first delta: names are enough
  }
  // New products: fetch their full details.
  const newOnes = added.slice(0, 60).map((sku) => async () => {
    const row = await exactRow(pace, sku, deadline);
    if (row) bySku.set(row[R.sku], row);
  });
  if (!(await runPaced(newOnes, deadline))) return { ...out, rows: [...bySku.values()] };
  out.cursor = cursor;

  // 2. Today's trade price and SRP for every product; drop any no longer priced.
  const skus = [...bySku.keys()];
  const priceTasks = [];
  for (let i = 0; i < skus.length; i += BULK_MAX) {
    const chunk = skus.slice(i, i + BULK_MAX);
    priceTasks.push(async () => {
      const { data } = await pacedRequest(pace, '/v1/pricing/bulk', { skus: chunk }, deadline);
      for (const p of data?.data || []) {
        const row = bySku.get(p.sku);
        if (!row) continue;
        const o = option(p);
        if (p.error === 'not_found' || o.status !== 'Available') bySku.delete(p.sku);
        else {
          row[R.cost] = o.cost;
          row[R.srp] = o.noSrp ? null : o.price;
        }
      }
    });
  }
  if (!(await runPaced(priceTasks, deadline))) return { ...out, rows: [...bySku.values()] };

  // 3. Stock for everything (Habitech's full stock list, 500 at a time).
  const applyStock = (data) => {
    for (const s of data?.data || []) {
      const row = bySku.get(s.sku);
      if (row) {
        row[R.stock] = STOCK_CODE[s.status] || '';
        row[R.qty] = s.quantity_available ?? null;
      }
    }
  };
  if (!timeLeft()) return { ...out, rows: [...bySku.values()] };
  const first = await pacedRequest(pace, '/v1/stock?limit=500&offset=0', undefined, deadline);
  applyStock(first.data);
  const total = Number(first.data?.pagination?.total) || 0;
  const stockTasks = [];
  for (let offset = 500; offset < total; offset += 500) {
    stockTasks.push(async () => applyStock((await pacedRequest(pace, `/v1/stock?limit=500&offset=${offset}`, undefined, deadline)).data));
  }
  if (await runPaced(stockTasks, deadline)) out.refreshedAt = new Date().toISOString();
  return { ...out, rows: [...bySku.values()] };
}

module.exports = {
  id: 'habitech',
  name: 'Habitech (trade account)',
  label: 'Habitech',
  tabName: 'Habitech',
  site: 'habitech.co.uk',
  keyName: 'HABITECH_API_KEY',
  configured,
  search,
  product,
  prices,
  status,
  startCopy,
  continueCopy,
  finishCopy,
  refreshCopy,
  toProduct, // for tests
  rowFrom, // for tests
};
