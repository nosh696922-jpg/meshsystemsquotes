// Ubiquiti UK store catalogue.
//
// The store (uk.store.ui.com) is a Next.js site. Each top-level category page
// embeds its full product list, with prices, in a <script id="__NEXT_DATA__">
// JSON block. We read those pages and turn them into a flat product list.
//
// Prices from the store are in pence and exclude VAT.

const STORE_ORIGIN = 'https://uk.store.ui.com';
const STORE_PATH = '/uk/en';

// Top-level categories. Between them they cover the whole UK catalogue.
const CATEGORIES = [
  { slug: 'all-cloud-gateways', name: 'Cloud Gateways' },
  { slug: 'all-switching', name: 'Switching' },
  { slug: 'all-wifi', name: 'WiFi' },
  { slug: 'all-physical-security', name: 'Camera Security' },
  { slug: 'all-door-access', name: 'Door Access' },
  { slug: 'all-integrations', name: 'Integrations' },
  { slug: 'all-accessories', name: 'Accessories' },
];

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const REGION_WORDS = ['UK', 'EU', 'US', 'AU', 'CA', 'JP', 'IN', 'BR', 'IL', 'ZA', 'SG', 'CN', 'MX'];

function imageUrl(url, width = 256) {
  if (!url) return null;
  return `https://images.svc.ui.com/?u=${encodeURIComponent(url)}&q=75&w=${width}`;
}

const WORD_FIXES = {
  wifi: 'WiFi', poe: 'PoE', iot: 'IoT', nvr: 'NVR', ptz: 'PTZ', wan: 'WAN', xg: 'XG', voip: 'VoIP',
  dacs: 'DACs', max: 'Max', hub: 'Hub', kit: 'Kit',
};

function titleCaseSlug(slug) {
  return String(slug || '')
    .replace(/^(physical-security|cloud-gateways|switching|wifi|door-access|accessories|integrations)-/, '')
    .split('-')
    .map((w) => WORD_FIXES[w] || w[0].toUpperCase() + w.slice(1))
    .join(' ')
    .replace('Cables DACs', 'Cables & DACs')
    .replace('Modules Fiber', 'Modules & Fibre')
    .replace('Sensors Alarms', 'Sensors & Alarms')
    .replace('Dome Turret', 'Dome & Turret')
    .replace('PoE Power', 'PoE & Power');
}

async function fetchCategory(slug) {
  const url = `${STORE_ORIGIN}${STORE_PATH}/category/${slug}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'en-GB,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`Ubiquiti store returned ${res.status} for ${slug}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`Could not find product data on ${slug} (the store layout may have changed)`);
  const data = JSON.parse(match[1]);
  const subCategories = data?.props?.pageProps?.subCategories;
  if (!Array.isArray(subCategories)) throw new Error(`No product list on ${slug} (the store layout may have changed)`);
  return subCategories;
}

// Work out a readable label for a variant from the product's option values,
// e.g. "1 m · White · 10-Pack".
function variantLabel(variant, optionValueTitles) {
  const parts = (variant.optionValueIds || []).map((id) => optionValueTitles.get(id)).filter(Boolean);
  return parts.map((p) => p.value).join(' · ');
}

function isOtherRegion(variant, optionValueTitles) {
  return (variant.optionValueIds || []).some((id) => {
    const v = optionValueTitles.get(id);
    if (!v) return false;
    const words = v.value.toUpperCase().split(/[^A-Z]+/);
    return words.some((w) => REGION_WORDS.includes(w) && w !== 'UK');
  });
}

function isUkRegion(variant, optionValueTitles) {
  return (variant.optionValueIds || []).some((id) => {
    const v = optionValueTitles.get(id);
    return v && v.value.toUpperCase().split(/[^A-Z]+/).includes('UK');
  });
}

function toProduct(raw, category, subCategoryId) {
  const optionValueTitles = new Map();
  for (const option of raw.options || []) {
    for (const value of option.values || []) {
      optionValueTitles.set(value.id, { option: option.title, value: value.title });
    }
  }

  let variants = (raw.variants || []).filter(
    (v) => v.isVisibleInStore !== false && v.status !== 'RegionNotAvailable' && v.displayPrice,
  );
  // If there is a UK version, drop the EU/US/etc. versions of the same product.
  if (variants.some((v) => isUkRegion(v, optionValueTitles))) {
    variants = variants.filter((v) => !isOtherRegion(v, optionValueTitles));
  }
  if (!variants.length) return null;

  const mapped = variants.map((v) => {
    const price = v.displayPrice?.amount ?? 0;
    const withSurcharge = v.displayPriceWithSurcharges?.amount ?? price;
    return {
      sku: v.sku,
      displaySku: v.displaySku || v.sku,
      label: variantLabel(v, optionValueTitles),
      price, // pence, ex VAT
      surcharge: Math.max(0, withSurcharge - price),
      regularPrice: v.displayRegularPrice?.amount ?? null,
      status: v.status,
    };
  });

  // Products listed at £0 are not actually purchasable yet.
  const priced = mapped.filter((v) => v.price > 0);
  const finalVariants = priced.length ? priced : mapped;
  const defaultVariant =
    finalVariants.find((v) => v.status === 'Available' && v.price > 0) || finalVariants[0];

  return {
    id: `ubiquiti:${raw.id}`,
    manufacturer: 'Ubiquiti',
    source: 'ubiquiti',
    name: raw.title || raw.name,
    shortName: raw.shortTitle || raw.title || raw.name,
    model: raw.displaySku || raw.name,
    description: raw.shortDescription || '',
    category: category.name,
    subCategory: titleCaseSlug(subCategoryId),
    image: imageUrl(raw.thumbnail?.url, 256),
    imageLarge: imageUrl(raw.thumbnail?.url, 640),
    url: `${STORE_ORIGIN}${STORE_PATH}/category/${subCategoryId}/products/${raw.slug}`,
    surchargeTypes: raw.productSurchargeTypes || [],
    variants: finalVariants,
    defaultSku: defaultVariant.sku,
    price: defaultVariant.price,
    status: defaultVariant.status,
  };
}

async function sync({ onProgress } = {}) {
  const products = new Map();
  const errors = [];

  for (const category of CATEGORIES) {
    try {
      onProgress?.(`Reading ${category.name}…`);
      const subCategories = await fetchCategory(category.slug);
      for (const sub of subCategories) {
        for (const raw of sub.products || []) {
          // A product can appear in more than one category; keep the first.
          const id = `ubiquiti:${raw.id}`;
          if (products.has(id)) continue;
          const product = toProduct(raw, category, sub.id);
          if (product) products.set(id, product);
        }
      }
    } catch (err) {
      errors.push(`${category.name}: ${err.message}`);
    }
  }

  if (!products.size) {
    throw new Error(`Could not read any products from the Ubiquiti store. ${errors.join('; ')}`);
  }

  return {
    id: 'ubiquiti',
    name: 'Ubiquiti (UK store)',
    sourceUrl: `${STORE_ORIGIN}${STORE_PATH}`,
    currency: 'GBP',
    pricesIncludeVat: false,
    fetchedAt: new Date().toISOString(),
    errors,
    // Keep the store's own order: categories as listed above, then the
    // store's ordering within each category (flagship products first).
    products: [...products.values()],
  };
}

module.exports = { id: 'ubiquiti', name: 'Ubiquiti (UK store)', label: 'Ubiquiti', tabName: 'Ubiquiti UK store', site: 'uk.store.ui.com', sync };
