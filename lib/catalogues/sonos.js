// Sonos UK shop catalogue.
//
// The shop (sonos.com/en-gb/shop) is a Next.js site. The page carries its
// product records (from Sonos's Salesforce shop) in a data stream of
// self.__next_f.push([1, "..."]) script chunks. We join those chunks, find
// each product record and turn it into our product shape. Pictures come from
// the product tiles in the page itself.
//
// Sonos shows consumer prices INCLUDING VAT, in whole pounds. We store prices
// in pence EXCLUDING VAT, like every other catalogue (price / 1.2).

const SHOP_URL = 'https://www.sonos.com/en-gb/shop';
const PRODUCT_URL = 'https://www.sonos.com/en-gb/shop/';
const VAT_RATE = 0.2;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Sonos's own category ids are a bit cryptic; these are the ones its UK shop uses.
const CATEGORY_NAMES = {
  soundbars: 'Soundbars',
  speakers: 'Speakers',
  'wireless-speakers': 'Speakers',
  'portable-speakers': 'Portable speakers',
  subwoofers: 'Subwoofers',
  wirelesshometheatre: 'Subwoofers',
  headphones: 'Headphones',
  sets: 'Sets',
  'speaker-sets': 'Sets',
  'speaker-sets-2': 'Sets',
  products: 'Sets',
  components: 'Components',
  'wireless-stereo-components': 'Components',
  'installed-audio': 'Installed audio',
  'sonos-architectural': 'Installed audio',
  'architectural-speakers': 'Installed audio',
  accessories: 'Accessories',
};

function categoryName(id) {
  const key = String(id || '').toLowerCase();
  if (CATEGORY_NAMES[key]) return CATEGORY_NAMES[key];
  if (!key) return 'Other';
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words[0].toUpperCase() + words.slice(1);
}

// Whole pounds including VAT -> pence excluding VAT.
function exVatPence(pounds) {
  const n = Number(pounds);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n * 100) / (1 + VAT_RATE));
}

// Join the Next.js data stream chunks into one string.
function dataStream(html) {
  let text = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      text += JSON.parse(m[1]);
    } catch {
      // skip a chunk we can't read
    }
  }
  return text;
}

// The JSON object that contains position `index` in `text`.
function objectAround(text, index) {
  let depth = 0;
  let start = index;
  for (; start > 0; start--) {
    const ch = text[start];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) break;
      depth--;
    }
  }
  let d = 0;
  let inString = false;
  for (let end = start; end < text.length; end++) {
    const ch = text[end];
    if (inString) {
      if (ch === '\\') end++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') d++;
    else if (ch === '}') {
      d--;
      if (d === 0) return JSON.parse(text.slice(start, end + 1));
    }
  }
  throw new Error('unfinished record');
}

// Product pictures. Sonos's content records look like
//   {"media":[{"_type":"productImage","asset":{"_ref":"image-<hash>-2000x2000-png"},"tags":["plp",…]}],"name":"Era 100","slug":"shop/era-100"}
// and an image reference maps to https://media.sonos.com/images/<project>/<hash>-2000x2000.png.
function productImages(stream, html) {
  const project = (html.match(/media\.sonos\.com\/images\/([a-z0-9]+\/[a-z]+)\//) || [])[1] || 'znqtjj88/production';
  const toUrl = (ref) => {
    const m = String(ref || '').match(/^image-([a-f0-9]+)-(\d+x\d+)-([a-z]+)$/);
    return m ? `https://media.sonos.com/images/${project}/${m[1]}-${m[2]}.${m[3]}` : null;
  };
  const images = new Map();
  for (const m of stream.matchAll(/"slug":"shop\/([a-z0-9-]+)"/g)) {
    if (images.has(m[1])) continue;
    let record;
    try {
      record = objectAround(stream, m.index);
    } catch {
      continue;
    }
    const media = (record.media || []).filter((x) => x && x._type === 'productImage' && x.asset && x.asset._ref);
    const pick = media.find((x) => (x.tags || []).includes('plp')) || media[0];
    const url = pick && toUrl(pick.asset._ref);
    if (url) images.set(m[1], url);
  }
  // Also any product tiles that were drawn into the page.
  for (const m of html.matchAll(/href="\/en-gb\/shop\/([a-z0-9-]+)"/g)) {
    if (images.has(m[1])) continue;
    const img = html.slice(m.index, m.index + 5000).match(/https:\/\/media\.sonos\.com\/images\/[^"?\s]+\.(?:png|jpg|jpeg|webp)/i);
    if (img) images.set(m[1], img[0]);
  }
  return images;
}

function imageUrl(base, width) {
  return base ? `${base}?w=${width}&q=90&fit=clip&auto=format` : null;
}

function parseShop(html) {
  const stream = dataStream(html);
  if (!stream) throw new Error('Could not find the product data on the Sonos shop page (the site may have changed)');
  const images = productImages(stream, html);

  const records = new Map();
  for (const m of stream.matchAll(/"slugUrl":"/g)) {
    let raw;
    try {
      raw = objectAround(stream, m.index);
    } catch {
      continue;
    }
    if (!raw || !raw.id || !raw.name || typeof raw.price !== 'number' || (raw.currency && raw.currency !== 'GBP')) continue;
    if (raw.c_localeDisableProduct === true) continue;
    // Leave out Sonos's certified refurbished stock.
    if (/^refurbished\b/i.test(raw.name) || /refurb/i.test(`${raw.id} ${raw.primaryCategoryId || ''}`)) continue;
    // Keep the fullest copy of each product (some appear more than once).
    const prev = records.get(raw.id);
    if (!prev || JSON.stringify(raw).length > JSON.stringify(prev).length) records.set(raw.id, raw);
  }

  const products = [];
  for (const raw of records.values()) {
    const product = toProduct(raw, images);
    if (product) products.push(product);
  }
  return products;
}

function toProduct(raw, images) {
  const colourNames = new Map();
  for (const attr of raw.variationAttributes || []) {
    for (const v of attr.values || []) colourNames.set(`${attr.id}:${v.value}`, v.name);
  }
  const expanded = new Map((raw.c_expandedVariants || []).map((v) => [v.id, v]));

  let variants = (raw.variants || []).map((v) => {
    const extra = expanded.get(v.productId) || {};
    const label = Object.entries(v.variationValues || {})
      .map(([attr, value]) => colourNames.get(`${attr}:${value}`) || value)
      .join(' · ');
    const sku = extra.c_SKU || extra.c_VPN || v.productId;
    const inStock = extra.inventory ? extra.inventory.orderable !== false : v.orderable !== false;
    return {
      sku,
      displaySku: sku,
      label,
      price: exVatPence(v.price ?? extra.price ?? raw.price),
      surcharge: 0,
      status: inStock ? 'Available' : 'SoldOut',
      variantId: v.productId,
    };
  });
  // Products without colour options are a single variant.
  if (!variants.length) {
    const only = (raw.c_expandedVariants || [])[0] || {};
    const sku = only.c_SKU || only.c_VPN || raw.id;
    variants = [{ sku, displaySku: sku, label: '', price: exVatPence(raw.price), surcharge: 0, status: raw.inventory?.orderable === false ? 'SoldOut' : 'Available', variantId: raw.id }];
  }
  variants = variants.filter((v) => v.price > 0);
  if (!variants.length) return null;

  const defaultVariant = variants.find((v) => v.status === 'Available') || variants[0];
  const picture = images.get(defaultVariant.variantId) || images.get(raw.id) || variants.map((v) => images.get(v.variantId)).find(Boolean) || null;

  return {
    id: `sonos:${raw.id}`,
    manufacturer: 'Sonos',
    source: 'sonos',
    name: `Sonos ${raw.name}`.replace(/^Sonos Sonos /, 'Sonos '),
    shortName: raw.name,
    model: defaultVariant.sku,
    description: '',
    category: categoryName(raw.primaryCategoryId || raw.c_categoryID),
    subCategory: '',
    image: imageUrl(picture, 256),
    imageLarge: imageUrl(picture, 640),
    url: PRODUCT_URL + raw.id,
    variants: variants.map(({ variantId, ...v }) => v),
    defaultSku: defaultVariant.sku,
    price: defaultVariant.price,
    status: variants.some((v) => v.status === 'Available') ? 'Available' : 'SoldOut',
  };
}

// The shop page only draws pictures for a few products. Each product's own
// page names its picture (og:image) about 200 KB in, so read just the start
// of the page and stop once it's found.
async function pagePicture(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' } });
  if (!res.ok || !res.body) return null;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < 400000) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const m = text.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/) || text.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:image"/);
      if (m && /^https:\/\/media\.sonos\.com\//.test(m[1])) return m[1].split('?')[0];
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return null;
}

// Fill in missing pictures: first from the last refresh (they rarely change),
// then from product pages, a few at a time, within a time limit. Anything
// left over is picked up on the next refresh.
async function addPictures(products, previous, onProgress, timeLimitMs = 25000) {
  const known = new Map((previous?.products || []).filter((p) => p.image).map((p) => [p.id, p]));
  const missing = [];
  for (const p of products) {
    if (p.image) continue;
    const before = known.get(p.id);
    if (before) {
      p.image = before.image;
      p.imageLarge = before.imageLarge;
    } else missing.push(p);
  }
  const deadline = Date.now() + timeLimitMs;
  let next = 0;
  let found = 0;
  const worker = async () => {
    while (next < missing.length && Date.now() < deadline) {
      const p = missing[next++];
      try {
        const base = await pagePicture(p.url);
        if (base) {
          p.image = imageUrl(base, 256);
          p.imageLarge = imageUrl(base, 640);
          found++;
          onProgress?.(`Fetching pictures (${found} of ${missing.length})…`);
        }
      } catch {
        // try again next refresh
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  // Sets and bundles without their own picture borrow the main product's,
  // e.g. "Surround Set with Arc Ultra" uses Arc Ultra's.
  const pictured = products.filter((p) => p.image && p.category !== 'Sets').sort((a, b) => b.shortName.length - a.shortName.length);
  for (const p of products) {
    if (p.image) continue;
    const name = p.shortName.toLowerCase();
    const main = pictured.find((q) => q !== p && q.shortName.length > 2 && name.includes(q.shortName.toLowerCase()));
    if (main) {
      p.image = main.image;
      p.imageLarge = main.imageLarge;
    }
  }
}

async function sync({ onProgress, previous } = {}) {
  onProgress?.('Reading the Sonos UK shop…');
  const res = await fetch(SHOP_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`The Sonos shop returned ${res.status}`);
  const products = parseShop(await res.text());
  if (!products.length) throw new Error('Could not read any products from the Sonos shop (the site may have changed)');
  await addPictures(products, previous, onProgress);
  return {
    id: 'sonos',
    name: 'Sonos (UK shop)',
    sourceUrl: SHOP_URL,
    currency: 'GBP',
    pricesIncludeVat: false, // converted from the shop's VAT-inclusive prices
    fetchedAt: new Date().toISOString(),
    errors: [],
    products,
  };
}

module.exports = {
  id: 'sonos',
  name: 'Sonos (UK shop)',
  label: 'Sonos',
  tabName: 'Sonos UK shop',
  site: 'sonos.com/en-gb/shop',
  sync,
  parseShop, // for testing against a saved page
};
