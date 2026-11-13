// NetXL (UK networking distributor), read through NetXL's API with our trade
// account's key. Their whole catalogue (about 4,300 products) comes back in a
// few pages, so it's copied once a day like the Ubiquiti and Sonos shops.
//
// Needs NETXL_API_KEY (from netxl.com → My Account → Trade & API): in Vercel →
// Settings → Environment Variables, or in the .env file on your own computer.
// The key stays on the server; browsers never see it.
//
// API docs: https://netxl.com/llms-full.txt (OpenAPI: https://api.netxl.com/openapi.json).
// Each product carries our account's price for 1, 5+ and 10+ units, the
// recommended retail price, live stock and incoming deliveries, all in pounds.
// We sell at the RRP (or at our cost when NetXL gives none) and our cost is
// the single-unit price.

const BASE = 'https://api.netxl.com';
const SITE = 'https://www.netxl.com';
const PAGE_SIZE = 500; // NetXL's largest page
const IN_FLIGHT = 3; // pages fetched at once
const TIMEOUT_MS = 25000;
const MAX_PAGES = 40;
const VAT_RATE = 0.2;
// Whether NetXL's RRP (consumer_unit_cost) includes VAT. Our account prices
// are net (ex VAT). Checked against real prices: see README.
const RRP_INCLUDES_VAT = false;

const apiKey = () => (process.env.NETXL_API_KEY || '').trim();
const configured = () => Boolean(apiKey());
const NOT_SET_UP = 'The NetXL API key isn’t set up yet. Add NETXL_API_KEY in Vercel → Settings → Environment Variables (or in the .env file on your own computer).';

function fail(message) {
  return new Error(message);
}

async function request(path) {
  if (!configured()) throw fail(NOT_SET_UP);
  let res;
  try {
    res = await fetch(BASE + path, {
      headers: { 'X-Api-Key': apiKey(), Accept: 'application/json', 'User-Agent': 'MeshQuotes/1.0' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const why = err.name === 'TimeoutError' ? 'it took too long to answer' : 'no connection';
    throw fail(`Couldn’t reach NetXL (${why}). Try again in a moment.`);
  }
  if (res.ok) return { data: await res.json(), headers: res.headers };
  const body = await res.json().catch(() => null);
  if (res.status === 401) throw fail('NetXL didn’t accept the API key. It may have been replaced or switched off: make a new one in NetXL → My Account → Trade & API.');
  if (res.status === 403) throw fail('NetXL has paused requests from this server for a few minutes (after several wrong API keys). Try again in 5 minutes.');
  if (res.status === 429) {
    const wait = Number(body?.retry_after_seconds || res.headers.get('retry-after')) || 60;
    const per = body?.window ? ` per ${body.window}` : '';
    throw fail(`NetXL’s limit${body?.limit ? ` of ${body.limit} requests${per}` : ''} was reached. Try again in ${wait < 120 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.`);
  }
  throw fail(`NetXL returned an error (${res.status})${body?.message ? `: ${body.message}` : ''}.`);
}

const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Pounds → pence, or null for a missing, zero or negative price.
function pence(pounds, includesVat = false) {
  const n = Number(pounds);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n * 100) / (includesVat ? 1 + VAT_RATE : 1));
}

// "ubiquiti" → "Ubiquiti" when NetXL's maker list doesn't name it.
function titleCase(key) {
  return tidy(String(key || '').replace(/[-_]+/g, ' ')).replace(/\b\w/g, (c) => c.toUpperCase()) || 'Other';
}

// NetXL's categories are a tree of { key, name, children }; we want each
// key's name and how deep it is (the deepest is the most specific).
function categoryIndex(tree) {
  const index = new Map();
  const walk = (nodes, depth) => {
    for (const node of Array.isArray(nodes) ? nodes : []) {
      if (node?.key) index.set(String(node.key), { name: tidy(node.name) || titleCase(node.key), depth });
      walk(node?.children, depth + 1);
    }
  };
  walk(tree, 0);
  return index;
}

// The product's most specific category. NetXL's category list only goes two
// levels deep, so a key missing from it is taken to be a deeper one.
function categoryOf(keys, categories) {
  let best = null;
  for (const key of Array.isArray(keys) ? keys : []) {
    const known = categories.get(String(key)) || { name: titleCase(key), depth: 3 };
    if (!best || known.depth >= best.depth) best = known;
  }
  return best?.name || 'Other';
}

// In stock, low or out, in the words the rest of the app uses.
function stockLevel(availability) {
  const available = Number(availability?.available);
  const status = String(availability?.status || '');
  if (Number.isFinite(available) && available > 0) return /low/i.test(status) ? 'low_stock' : 'in_stock';
  return 'out_of_stock';
}

// The next delivery NetXL expects, as yyyy-mm-dd.
function nextDelivery(availability) {
  const dates = (availability?.incoming || [])
    .filter((d) => Number(d?.incoming) > 0 && /^\d{4}-\d{2}-\d{2}/.test(String(d?.expected_on || '')))
    .map((d) => String(d.expected_on).slice(0, 10))
    .sort();
  return dates[0] || null;
}

function toProduct(raw, { makers, categories, refurbished }) {
  const sku = tidy(raw?.sku);
  if (!sku) return null;
  const cost = pence(raw.single_unit_cost);
  const rrp = pence(raw.consumer_unit_cost, RRP_INCLUDES_VAT);
  const price = rrp || cost;
  if (!price) return null; // nothing to sell it at
  const images = Array.isArray(raw.images) ? raw.images : [];
  const picture = (images.find((i) => i?.is_primary) || images[0])?.url || null;
  const available = Number(raw.availability?.available);
  const variant = {
    sku,
    displaySku: sku,
    label: '',
    price,
    cost,
    surcharge: 0,
    status: 'Available',
    noSrp: !rrp,
    stock: stockLevel(raw.availability),
    qty: Number.isFinite(available) ? Math.max(0, available) : null,
    restockDate: nextDelivery(raw.availability),
  };
  const makerKey = String(raw.manufacturer || '');
  return {
    id: `netxl:${sku}`,
    source: 'netxl',
    manufacturer: makers.get(makerKey) || titleCase(makerKey),
    name: tidy(raw.name) || sku,
    shortName: tidy(raw.name) || sku,
    model: sku,
    description: '',
    category: categoryOf(raw.categories, categories),
    subCategory: '',
    image: picture,
    imageLarge: picture,
    url: /^https?:\/\//i.test(String(raw.store_url || '')) ? raw.store_url : null,
    price,
    cost,
    status: 'Available',
    defaultSku: sku,
    variants: [variant],
    // NetXL's "reduced" products are refurbished: the Hide graded stock switch hides them.
    graded: refurbished.has(sku) || undefined,
  };
}

// Every page of a product list, a few at a time.
async function allPages(query, onPage) {
  const first = await request(`/product?${query}&limit=${PAGE_SIZE}&page=1`);
  const rows = [...(Array.isArray(first.data) ? first.data : [])];
  const pages = Math.min(MAX_PAGES, Number(first.headers.get('x-total-pages')) || (rows.length < PAGE_SIZE ? 1 : MAX_PAGES));
  const total = Number(first.headers.get('x-total-count')) || null;
  onPage?.(rows.length, total);
  for (let page = 2; page <= pages; page += IN_FLIGHT) {
    const batch = [];
    for (let p = page; p < page + IN_FLIGHT && p <= pages; p++) batch.push(request(`/product?${query}&limit=${PAGE_SIZE}&page=${p}`));
    const results = await Promise.all(batch);
    let ended = false;
    for (const { data } of results) {
      const list = Array.isArray(data) ? data : [];
      rows.push(...list);
      if (list.length < PAGE_SIZE) ended = true;
    }
    onPage?.(rows.length, total);
    if (ended) break;
  }
  return rows;
}

async function sync({ onProgress } = {}) {
  if (!configured()) throw fail(NOT_SET_UP);
  onProgress?.('Reading NetXL…');
  const errors = [];
  const [makerList, categoryTree, rows, reducedRows] = await Promise.all([
    request('/manufacturer').then((r) => r.data).catch((err) => (errors.push(`Brand names: ${err.message}`), [])),
    request('/category').then((r) => r.data).catch((err) => (errors.push(`Categories: ${err.message}`), [])),
    allPages('', (n, total) => onProgress?.(`Reading NetXL products… ${n.toLocaleString('en-GB')}${total ? ` of ${total.toLocaleString('en-GB')}` : ''}`)),
    allPages('reduced=true').catch((err) => (errors.push(`Refurbished list: ${err.message}`), [])),
  ]);
  const makers = new Map((Array.isArray(makerList) ? makerList : []).map((m) => [String(m.key), tidy(m.name) || titleCase(m.key)]));
  const categories = categoryIndex(categoryTree);
  const refurbished = new Set(reducedRows.map((r) => tidy(r?.sku)).filter(Boolean));

  const seen = new Set();
  const products = [];
  for (const raw of rows) {
    const product = toProduct(raw, { makers, categories, refurbished });
    if (!product || seen.has(product.id)) continue;
    seen.add(product.id);
    products.push(product);
  }
  if (!products.length) throw fail('NetXL sent no priced products. Check the API key belongs to our trade account.');
  return {
    id: 'netxl',
    name: 'NetXL (trade account)',
    sourceUrl: SITE,
    currency: 'GBP',
    pricesIncludeVat: false,
    fetchedAt: new Date().toISOString(),
    errors,
    products,
  };
}

module.exports = {
  id: 'netxl',
  name: 'NetXL (trade account)',
  label: 'NetXL',
  tabName: 'NetXL',
  site: 'netxl.com',
  keyName: 'NETXL_API_KEY',
  configured,
  sync,
  toProduct, // for testing
  categoryIndex,
};
