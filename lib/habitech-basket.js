// Puts a quote's Habitech products in our basket on Habitech's website.
//
// Habitech's API can only read (prices, stock, orders), so it can't fill a
// basket. Habitech's website runs on NetSuite SuiteCommerce, though, and that
// takes a link which adds several items to the basket of whoever opens it:
//
//   https://www.habitech.co.uk/app/site/backend/additemtocart.nl
//     ?c=5345244&n=2&buyid=multi&multi=<id>,<qty>;<id>,<qty>
//
// The ids are the website's own item numbers, not Habitech's part codes, so
// each part code is looked up with the website's public product search
// (/api/items) and the answer is remembered. A product sold in options (e.g.
// a keypad finish) is listed under its main product, so we look in there too.
//
// This isn't part of Habitech's documented API, so it could stop working if
// Habitech change their website. It needs no API key or login: the basket
// belongs to whoever opens the link, in their own browser.

const store = require('./store');

const SHOP = 'https://www.habitech.co.uk';
const COMPANY = '5345244'; // Habitech's NetSuite account
const SITE_ID = '2'; // their website within it
const BASKET_LINK = `${SHOP}/app/site/backend/additemtocart.nl?c=${COMPANY}&n=${SITE_ID}&buyid=multi&multi=`;

const CACHE = 'habitech-web'; // remembered ids, saved as catalogue "habitech-web"
const MAX_SKUS = 150; // per request
const IN_FLIGHT = 4; // lookups at once, to be gentle on Habitech's website
const TIMEOUT_MS = 10000;
const DEADLINE_MS = 40000; // stay well inside Vercel's one-minute limit
const DAY = 24 * 3600e3;
const RECHECK_FOUND = 30 * DAY; // website ids rarely change
const RECHECK_MISSING = DAY; // a product may be added to the website tomorrow
const MAX_REMEMBERED = 5000;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

const validId = (id) => (Number.isInteger(Number(id)) && Number(id) > 0 ? Number(id) : null);

// The website's item number for one Habitech part code, or null if the
// website doesn't sell it (services, custom items, licences…).
async function lookUp(sku) {
  const params = new URLSearchParams({
    q: sku, fieldset: 'search', limit: '10', c: COMPANY, n: SITE_ID, country: 'GB', currency: 'GBP', language: 'en',
  });
  const res = await fetch(`${SHOP}/api/items?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Habitech’s website returned an error (${res.status})`);
  const data = await res.json();
  const want = sku.toUpperCase();
  for (const item of data?.items || []) {
    if (String(item.itemid).toUpperCase() === want) return validId(item.internalid);
    for (const child of item.matrixchilditems_detail || []) {
      if (String(child.itemid).toUpperCase() === want) return validId(child.internalid);
    }
  }
  return null;
}

// { ids: { [sku]: website id }, missing: [sku], unchecked: [sku], link }
// `missing` aren't sold on the website; `unchecked` couldn't be looked up
// this time (the website didn't answer, or it took too long).
async function find(skuList) {
  const skus = [...new Set((Array.isArray(skuList) ? skuList : [])
    .map((s) => String(s || '').trim())
    .filter((s) => s && s.length <= 100))];
  if (!skus.length) throw fail(400, 'No Habitech products to look up.');
  if (skus.length > MAX_SKUS) throw fail(400, `Up to ${MAX_SKUS} Habitech products can go in the basket at once.`);

  const saved = (await store.getCatalogue(CACHE))?.ids || {};
  const started = Date.now();
  const ids = {};
  const missing = [];
  const unchecked = [];
  const todo = [];
  for (const sku of skus) {
    const hit = saved[sku.toUpperCase()];
    if (hit && started - hit.at < (hit.id ? RECHECK_FOUND : RECHECK_MISSING)) {
      if (hit.id) ids[sku] = hit.id;
      else missing.push(sku);
    } else {
      todo.push(sku);
    }
  }

  let next = 0;
  let looked = 0;
  let lastError = null;
  async function worker() {
    while (next < todo.length) {
      const sku = todo[next++];
      if (Date.now() - started > DEADLINE_MS) {
        unchecked.push(sku);
        continue;
      }
      try {
        const id = await lookUp(sku);
        saved[sku.toUpperCase()] = { id, at: Date.now() };
        looked++;
        if (id) ids[sku] = id;
        else missing.push(sku);
      } catch (err) {
        lastError = err;
        unchecked.push(sku);
      }
    }
  }
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));

  if (looked) {
    // Keep the most recently checked, so the list can't grow without limit.
    const entries = Object.entries(saved).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_REMEMBERED);
    await store.saveCatalogue(CACHE, { ids: Object.fromEntries(entries) }).catch((err) => {
      console.warn(`Could not remember Habitech website ids: ${err.message}`);
    });
  }

  if (todo.length && unchecked.length === skus.length && lastError) {
    const why = lastError.name === 'TimeoutError' ? 'it took too long to answer' : lastError.message;
    throw fail(502, `Couldn’t reach Habitech’s website (${why}). Try again in a moment.`);
  }
  return { ids, missing, unchecked, link: BASKET_LINK };
}

module.exports = { find };
