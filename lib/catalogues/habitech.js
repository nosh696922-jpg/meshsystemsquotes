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
  if (res.status === 429) throw fail(503, 'Too many Habitech searches in one minute. Wait a few seconds and try again.');
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

module.exports = {
  id: 'habitech',
  name: 'Habitech (trade account)',
  label: 'Habitech',
  tabName: 'Habitech',
  site: 'habitech.co.uk',
  configured,
  search,
  product,
  prices,
  status,
  toProduct, // for tests
};
