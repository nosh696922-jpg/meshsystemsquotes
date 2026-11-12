/* Mesh quoting tool — browser app (Vue 3, no build step). */

const { createApp, reactive, nextTick, toRaw } = Vue;
const C = window.QuoteCalc;

// ---- Small helpers -----------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));
const money = (p) => C.money(p);
const hours = (h) => C.hours(h);
const penceToPounds = (p) => (p == null || p === '' ? '' : (Number(p) / 100).toFixed(2));
const poundsToPence = (s) => Math.round(parseFloat(String(s).replace(/[£,\s]/g, '')) * 100);

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty response */
  }
  if (res.status === 401 && !url.startsWith('/api/login')) {
    goToSignIn();
  }
  if (res.status === 503 && data?.setup) {
    state.setupMessage = data.error;
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function goToSignIn() {
  location.href = `/login.html${location.hash && location.hash.length > 2 ? location.hash : ''}`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} day${s >= 172800 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function storageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

// Variant labels like "UK Version · Single Unit" add nothing on a quote.
function cleanVariantLabel(label) {
  return String(label || '')
    .split(' · ')
    .filter((p) => !/^(UK Version|Single Unit|Single)$/i.test(p.trim()))
    .join(' · ');
}

// Our own names for catalogue products, keyed by product id, e.g. a Ubiquiti
// UCG-Max added as "Home network router". Set on the Products page (Rename)
// or from a quote line ("Always add … with this name").
const productNames = reactive({ loaded: false, map: {} });
let namesLoading = null;

function loadProductNames() {
  if (productNames.loaded) return Promise.resolve();
  namesLoading ||= api('GET', '/api/product-names')
    .then((data) => {
      productNames.map = data.names || {};
      productNames.loaded = true;
    })
    .catch((err) => console.warn(`Could not load saved product names: ${err.message}`))
    .finally(() => {
      namesLoading = null;
    });
  return namesLoading;
}

// An empty name goes back to the maker's name.
async function saveProductName(id, name) {
  const { names } = await api('PUT', '/api/product-names', { id, name });
  productNames.map = names; // replaced whole, so lists that search the names update
  productNames.loaded = true;
}

const savedName = (id) => (id && productNames.map[id]) || '';

function itemFromProduct(product, variant, qty) {
  const label = cleanVariantLabel(variant.label);
  return {
    id: uid(),
    kind: 'product',
    source: product.source,
    productId: product.id,
    manufacturer: product.manufacturer,
    // Options such as a colour go after our name too: "Kitchen speaker (Black)".
    name: (savedName(product.id) || product.name) + (label ? ` (${label})` : ''),
    model: product.model,
    sku: variant.sku || product.model,
    variantLabel: label,
    description: product.description || '',
    image: product.image || null,
    url: product.url || null,
    basePrice: variant.price,
    surcharge: variant.surcharge || 0,
    costPrice: variant.cost ?? product.cost ?? null, // e.g. Crestron dealer price
    priceOverride: null,
    discount: 0,
    qty: Math.max(1, Number(qty) || 1),
    labour: [],
  };
}

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', changes: 'Changes requested', accepted: 'Accepted', declined: 'Declined' };
const STATUS_KEYS = Object.keys(STATUS_LABELS);
const CORE_LABOUR = ['installation', 'commissioning', 'programming', 'project_management'];
const REPLY_LABELS = { accept: 'Accepted online', changes: 'Changes requested', decline: 'Declined online' };
const REPLY_STATUS = { accept: 'accepted', changes: 'changes', decline: 'declined' };
const VERSION_KINDS = { manual: 'Saved', sent: 'Sent to client', accept: 'Client accepted', changes: 'Client asked for changes', decline: 'Client declined', restore: 'Before going back' };

// Copy saved items into a quote with fresh ids (for kits).
function freshItems(items) {
  return clone(items).map((item) => {
    item.id = uid();
    if (item.kind !== 'labour') item.labour = (item.labour || []).map((l) => ({ ...l, id: uid() }));
    return item;
  });
}

// What changed between two versions of a quote, as a list of plain sentences.
function diffQuotes(before, after) {
  const out = [];
  const add = (type, text) => out.push({ type, text });
  const itemLabel = (i) => (i.kind === 'labour' ? `${C.labourName(after, i.type) || 'Labour'} labour${i.description ? ` (${i.description})` : ''}` : i.name);
  const index = (q) => {
    const map = new Map();
    for (const s of q.sections || []) for (const i of s.items || []) map.set(i.id, { item: i, section: s });
    return map;
  };
  const oldSections = new Map((before.sections || []).map((s) => [s.id, s]));
  const newSections = new Map((after.sections || []).map((s) => [s.id, s]));
  for (const s of after.sections || []) {
    const old = oldSections.get(s.id);
    if (!old) add('add', `Added area “${s.name}”`);
    else if (old.name !== s.name) add('change', `Renamed area “${old.name}” to “${s.name}”`);
    else if ((old.description || '') !== (s.description || '')) add('change', `Changed the description of “${s.name}”`);
  }
  for (const s of before.sections || []) if (!newSections.has(s.id)) add('remove', `Removed area “${s.name}” (${(s.items || []).length} line${(s.items || []).length === 1 ? '' : 's'})`);

  const oldItems = index(before);
  const newItems = index(after);
  for (const [id, { item, section }] of newItems) {
    const was = oldItems.get(id);
    const where = newSections.size > 1 ? ` in ${section.name}` : '';
    if (!was) {
      add('add', item.kind === 'labour' ? `Added ${hours(item.hours)} of ${itemLabel(item)}${where}` : `Added ${item.qty} × ${item.name}${where}`);
      continue;
    }
    const a = was.item;
    const label = itemLabel(item);
    if (item.kind === 'labour') {
      if (Number(a.hours) !== Number(item.hours)) add('change', `${label}: ${hours(a.hours)} → ${hours(item.hours)}`);
      if (a.type !== item.type) add('change', `Changed labour type to ${C.labourName(after, item.type)}`);
    } else {
      if (Number(a.qty) !== Number(item.qty)) add('change', `${label}: quantity ${a.qty} → ${item.qty}`);
      const u1 = C.unitPrice(a, before);
      const u2 = C.unitPrice(item, after);
      if (u1 !== u2) add('change', `${label}: price ${money(u1)} → ${money(u2)} each`);
      if (Number(a.discount || 0) !== Number(item.discount || 0)) add('change', `${label}: discount ${Number(a.discount || 0)}% → ${Number(item.discount || 0)}%`);
      const h1 = C.itemTotals(a, before).labourHours;
      const h2 = C.itemTotals(item, after).labourHours;
      if (h1 !== h2) add('change', `${label}: labour ${hours(h1)} → ${hours(h2)}`);
      if (a.name !== item.name) add('change', `Renamed “${a.name}” to “${item.name}”`);
    }
    if (was.section.id !== section.id && newSections.has(was.section.id)) add('change', `Moved ${label} to ${section.name}`);
  }
  for (const [id, { item, section }] of oldItems) {
    if (newItems.has(id) || !newSections.has(section.id)) continue;
    add('remove', item.kind === 'labour' ? `Removed ${hours(item.hours)} of ${itemLabel(item)}` : `Removed ${item.qty} × ${item.name}`);
  }

  if (Number(before.markup || 0) !== Number(after.markup || 0)) add('change', `Markup ${before.markup || 0}% → ${after.markup || 0}%`);
  const d1 = C.quoteTotals(before);
  const d2 = C.quoteTotals(after);
  if (d1.discount !== d2.discount) add('change', `Quote discount ${money(d1.discount)} → ${money(d2.discount)}`);
  if (Number(before.vatRate) !== Number(after.vatRate)) add('change', `VAT ${before.vatRate}% → ${after.vatRate}%`);
  for (const t of after.labourTypes || []) {
    const old = (before.labourTypes || []).find((x) => x.id === t.id);
    if (old && Number(old.rate) !== Number(t.rate)) add('change', `${t.name} rate ${money(old.rate)} → ${money(t.rate)} per hour`);
  }
  const text = (q) => JSON.stringify([q.intro, q.scope?.map((s) => [s.heading, s.body]), q.terms]);
  if (text(before) !== text(after)) add('change', 'Changed the proposal text or terms');
  if (JSON.stringify(before.client || {}) !== JSON.stringify(after.client || {}) || (before.siteAddress || '') !== (after.siteAddress || '')) add('change', 'Changed the client details');
  if (before.title !== after.title) add('change', `Title “${before.title}” → “${after.title}”`);
  if (before.date !== after.date || Number(before.validDays) !== Number(after.validDays)) add('change', 'Changed the date or how long it is valid for');
  return { changes: out, totalBefore: d1.total, totalAfter: d2.total };
}

// ---- Shared state ------------------------------------------------------------

// ---- Light / dark mode ----------------------------------------------------------
// index.html sets the starting theme before the page draws (no flash). The
// choice is remembered on this device; until someone flips the switch, it
// follows the device's own light/dark setting.

const THEME_KEY = 'mesh.theme';
let themeTimer = null;

// Flipping the switch: the new mode spreads out in a circle from the switch,
// like light filling a room. The page is animated as one picture, so it stays
// smooth on slow machines. Browsers without that feature fade each colour instead.
function applyTheme(theme, animate) {
  const root = document.documentElement;
  const set = () => root.setAttribute('data-theme', theme);
  if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return set();
  if (document.startViewTransition) {
    const sw = document.querySelector('.light-switch');
    const box = sw ? sw.getBoundingClientRect() : { left: innerWidth, top: 0, width: 0, height: 0 };
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add('theme-switching');
    const vt = document.startViewTransition(set);
    vt.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 700, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    }).catch(() => {});
    vt.finished.finally(() => root.classList.remove('theme-switching'));
    return;
  }
  root.classList.add('theme-transition');
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => root.classList.remove('theme-transition'), 550);
  set();
}

const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
systemDark.addEventListener?.('change', (e) => {
  if (storageGet(THEME_KEY)) return; // someone chose a mode on purpose
  state.theme = e.matches ? 'dark' : 'light';
  applyTheme(state.theme, true);
});

const state = reactive({
  route: parseRoute(),
  theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
  session: null,
  setupMessage: null,
  settings: null,
  me: storageGet('mesh.me', ''),
  catalogue: { loaded: false, loading: false, syncing: false, importing: false, products: [], sources: [] },
  kits: { loaded: false, list: [] },
  toasts: [],
});

// ---- Installing as an app ----------------------------------------------------
// Edge and Chrome can install the site as a program with its own window and
// icon. The browser fires beforeinstallprompt when it's ready to offer that.
// The Windows program (desktop/MeshQuotes.cs) adds MeshQuotesApp to its user agent.
const IN_WINDOWS_APP = /MeshQuotesApp\//.test(navigator.userAgent);
const installApp = reactive({
  prompt: null,
  installed: IN_WINDOWS_APP || Boolean(window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
});
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // offer it from Settings instead of a pop-up bar
  installApp.prompt = e;
});
window.addEventListener('appinstalled', () => {
  installApp.prompt = null;
  installApp.installed = true;
});

const UA = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IS_PHONE = IS_IOS || /Android/.test(UA);
const IS_MAC = /Macintosh/.test(UA) && !IS_IOS;
const IS_WINDOWS = /Windows NT/.test(UA);

// Where an installed app lives on this device.
const INSTALL_PLACE = IS_PHONE ? 'the home screen' : IS_MAC ? 'the Dock' : 'the Start menu and taskbar';

function installHelpText() {
  const openIt = `If it’s already installed, open Mesh Quotes from ${IS_MAC ? 'Launchpad' : 'the Start menu'}.`;
  if (IS_IOS) return 'On iPhone or iPad, tap the Share button, then Add to Home Screen.';
  if (/Android/.test(UA)) return 'In Chrome, tap ⋮ at the top right, then Add to Home screen.';
  if (/Edg\//.test(UA)) return `In Edge, open the ⋯ menu at the top right, then Apps → Install this site as an app. ${openIt}`;
  if (/Chrome\//.test(UA)) return `In Chrome, open the ⋮ menu at the top right, then Cast, save and share → Install page as app. ${openIt}`;
  if (/Safari\//.test(UA) && IS_MAC) return 'In Safari, choose File → Add to Dock.';
  return 'Open this page in Microsoft Edge or Google Chrome to install it as an app.';
}

async function loadKits(force = false) {
  if (state.kits.loaded && !force) return;
  try {
    state.kits.list = await api('GET', '/api/kits');
    state.kits.loaded = true;
  } catch (err) {
    toast(`Could not load kits: ${err.message}`, 'error');
  }
}

// Current catalogue price (and cost, where the catalogue has one) for each
// product option, keyed by catalogue and SKU, e.g. "crestron|TSW-1070-B-S".
const priceKey = (item) => `${item.source}|${item.sku}`;

function storePriceIndex() {
  const index = {};
  for (const p of state.catalogue.products) {
    if (p.source === 'custom') continue;
    for (const v of p.variants) index[`${p.source}|${v.sku}`] = { ...v, cost: v.cost ?? p.cost ?? null };
  }
  return index;
}

// A copy of a saved line with today's catalogue price (used for kits).
function withCurrentPrice(item, prices) {
  const now = prices[priceKey(item)];
  if (!now) return item;
  const out = { ...item, basePrice: now.price, surcharge: now.surcharge || 0 };
  if (now.cost != null) out.costPrice = now.cost;
  return out;
}

const formatDay = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

// Before the catalogue list arrives, show these tabs.
const KNOWN_CATALOGUES = [
  { id: 'ubiquiti', label: 'Ubiquiti', tabName: 'Ubiquiti UK store', kind: 'web' },
  { id: 'sonos', label: 'Sonos', tabName: 'Sonos UK shop', kind: 'web' },
  { id: 'crestron', label: 'Crestron', tabName: 'Crestron price list', kind: 'import' },
  { id: 'habitech', label: 'Habitech', tabName: 'Habitech', kind: 'live' },
];
function catalogueSources() {
  const list = state.catalogue.sources.filter((s) => !s.custom);
  return list.length ? list : KNOWN_CATALOGUES;
}

const SEARCH_HINTS = {
  ubiquiti: 'Search Ubiquiti products, e.g. U7 Pro, USW-24-PoE, doorbell',
  sonos: 'Search Sonos, e.g. Arc Ultra, Era 100, Sub Mini, Amp',
  crestron: 'Search Crestron models, e.g. TSW-1070, DM-NVX, HZ2',
  habitech: 'Search Habitech by name, brand or part code, e.g. VX66R, HDMI cable, Sonance',
  custom: 'Search our products',
};

function parseRoute() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  if (parts[0] === 'quote' && parts[1]) return { name: 'quote', id: parts[1] };
  if (parts[0] === 'products') return { name: 'products' };
  if (parts[0] === 'settings') return { name: 'settings' };
  return { name: 'quotes' };
}
window.addEventListener('hashchange', () => {
  state.route = parseRoute();
  window.scrollTo(0, 0);
});

function toast(msg, type = 'ok') {
  const life = type === 'error' ? 6000 : 2800; // how long it stays, in ms
  const t = { id: uid(), msg, type, life };
  state.toasts.push(t);
  setTimeout(() => {
    const i = state.toasts.indexOf(t);
    if (i >= 0) state.toasts.splice(i, 1);
  }, life);
}

async function loadCatalogue(force = false) {
  if (state.catalogue.loading || (state.catalogue.loaded && !force)) return;
  state.catalogue.loading = true;
  try {
    const data = await api('GET', '/api/catalogue');
    state.catalogue.products = Object.freeze(data.products);
    state.catalogue.sources = data.sources;
    state.catalogue.loaded = true;
  } catch (err) {
    toast(`Could not load products: ${err.message}`, 'error');
  } finally {
    state.catalogue.loading = false;
  }
}

// Re-read a catalogue from the maker's website (Ubiquiti takes about 10
// seconds; Sonos a few). state.catalogue.syncing holds the catalogue's id.
async function syncCatalogue(id) {
  if (state.catalogue.syncing) return;
  state.catalogue.syncing = id;
  try {
    const data = await api('POST', `/api/catalogue/${id}/sync`);
    state.catalogue.sources = data.sources;
    const source = data.sources.find((s) => s.id === id) || {};
    if (source.error) toast(`${source.label || id} refresh had a problem: ${source.error}`, 'error');
    else toast(`${source.label || id} prices updated (${source.count} products)`);
    await loadCatalogue(true);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    state.catalogue.syncing = false;
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

// Import a supplier's price list file (e.g. Crestron's .xlsx). It replaces
// the previous list; quotes keep their own prices until you update them.
async function importCatalogue(id, file) {
  if (!file || state.catalogue.importing) return;
  if (file.size > 3 * 1024 * 1024) return toast('That file is too big to import (over 3 MB).', 'error');
  state.catalogue.importing = id;
  try {
    const data = await api('POST', `/api/catalogue/${id}/import`, { file: toBase64(await file.arrayBuffer()), fileName: file.name });
    state.catalogue.sources = data.sources;
    const r = data.result;
    const label = (data.sources.find((s) => s.id === id) || {}).label || id;
    toast(`Imported ${r.count.toLocaleString('en-GB')} ${label} products${r.skipped.length ? ` (${r.skipped.length} without a price left out)` : ''}`);
    await loadCatalogue(true);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    state.catalogue.importing = false;
  }
}

async function signOut() {
  await api('POST', '/api/logout').catch(() => {});
  location.href = '/login.html';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt('Copy this link:', text);
    return false;
  }
}

const sharedMethods = { money, hours, timeAgo, formatDateTime, penceToPounds };

// ---- Reusable inputs -----------------------------------------------------------

const MoneyInput = {
  props: { modelValue: { default: null }, placeholder: { default: null }, small: Boolean },
  emits: ['update:modelValue'],
  data() {
    return { text: penceToPounds(this.modelValue), focused: false };
  },
  watch: {
    modelValue(v) {
      if (!this.focused) this.text = penceToPounds(v);
    },
  },
  methods: {
    penceToPounds,
    onInput(e) {
      this.text = e.target.value;
      const t = this.text.trim();
      if (t === '') return this.$emit('update:modelValue', null);
      const p = poundsToPence(t);
      if (Number.isFinite(p)) this.$emit('update:modelValue', Math.max(0, p));
    },
    onBlur() {
      this.focused = false;
      this.text = penceToPounds(this.modelValue);
    },
  },
  template: `<label class="money-input" :class="{ small }"><span>£</span><input type="text" inputmode="decimal" :value="text" :placeholder="placeholder != null ? penceToPounds(placeholder) : '0.00'" @focus="focused = true" @input="onInput" @blur="onBlur"></label>`,
};

const AutoTextarea = {
  props: { modelValue: { type: String, default: '' }, placeholder: String, rows: { type: Number, default: 3 }, plain: Boolean },
  emits: ['update:modelValue'],
  mounted() {
    this.resize();
  },
  watch: {
    modelValue() {
      nextTick(() => this.resize());
    },
  },
  methods: {
    resize() {
      const el = this.$el;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + 2}px`;
    },
  },
  template: `<textarea :class="{ plain }" :value="modelValue" :placeholder="placeholder" :rows="rows" @input="$emit('update:modelValue', $event.target.value); resize()"></textarea>`,
};

const Modal = {
  props: { title: String, wide: Boolean },
  emits: ['close'],
  mounted() {
    this.onKey = (e) => e.key === 'Escape' && this.$emit('close');
    window.addEventListener('keydown', this.onKey);
  },
  unmounted() {
    window.removeEventListener('keydown', this.onKey);
  },
  template: `
    <div class="modal-backdrop" @mousedown.self="$emit('close')">
      <div class="modal" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title">
        <header class="modal-head">
          <h2>{{ title }}</h2>
          <button class="icon-btn" @click="$emit('close')" aria-label="Close">✕</button>
        </header>
        <div class="modal-body"><slot></slot></div>
        <footer class="modal-foot" v-if="$slots.footer"><slot name="footer"></slot></footer>
      </div>
    </div>`,
};

// ---- Product search (used by the picker and the products page) -----------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

// `filter` limits the list to one value of `filterKey` (a category, or a brand).
// `aliases` are our own names for products ({ id: name }), searched too.
function searchProducts(products, query, filter, filterKey = 'category', aliases = null) {
  const words = query.toLowerCase().split(/[\s-]+/).filter(Boolean);
  const nq = norm(query);
  const out = [];
  for (const p of products) {
    if (filter && p[filterKey] !== filter) continue;
    const alias = aliases && aliases[p.id] ? aliases[p.id].toLowerCase() : '';
    if (words.length) {
      if (!p._hay) {
        // Searchable text: "primary" (name, model, SKUs) and everything.
        const primary = [p.name, p.shortName, p.model, p.manufacturer, ...(p.variants || []).map((v) => v.sku)].join(' ').toLowerCase();
        Object.defineProperty(p, '_primary', { value: primary });
        Object.defineProperty(p, '_hay', { value: [primary, p.category, p.subCategory, p.description].join(' ').toLowerCase() });
      }
      if (!words.every((w) => p._hay.includes(w) || alias.includes(w))) continue;
    }
    let score = 0;
    if (nq) {
      const model = norm(p.model);
      if (model === nq) score += 100;
      else if (model.startsWith(nq)) score += 40;
      else if (model.includes(nq)) score += 20;
      if ((p.variants || []).some((v) => norm(v.sku) === nq)) score += 80;
      if (norm(p.shortName) === nq || norm(p.name) === nq || norm(alias) === nq) score += 60;
      else if (norm(p.name).includes(nq) || norm(alias).includes(nq)) score += 15;
      score += 5 * words.filter((w) => p._primary.includes(w) || alias.includes(w)).length;
    }
    out.push({ p, score });
  }
  if (nq) out.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
  return out.map((x) => x.p);
}

const STATUS_BADGE = { SoldOut: 'Sold out', ComingSoon: 'Coming soon', RegionNotAvailable: 'Unavailable', NoPrice: 'No trade price', Discontinued: 'Discontinued' };

// ---- Sorting product lists, and hiding graded or out-of-stock products -------
// Used by the product picker and the Products page. The choices are shared by
// both and remembered on this device.

const SORTS = { match: 'Best match', 'price-asc': 'Price: low to high', 'price-desc': 'Price: high to low', name: 'Name: A to Z' };
const VIEW_KEYS = { sort: 'mesh.productSort', hideGraded: 'mesh.hideGraded', hideOutOfStock: 'mesh.hideOutOfStock' };
const productView = reactive({
  sort: SORTS[storageGet(VIEW_KEYS.sort)] ? storageGet(VIEW_KEYS.sort) : 'match',
  hideGraded: storageGet(VIEW_KEYS.hideGraded) === '1',
  hideOutOfStock: storageGet(VIEW_KEYS.hideOutOfStock) === '1',
});

// Graded, ex-display or refurbished stock. Habitech starts these names with
// "Grade A -", "Graded B:" or "GRADED".
const GRADED = /^\s*graded?\b|\b(?:ex[- ]?display|ex[- ]?demo|b[- ]?stock|open[- ]?box|refurbished|pre[- ]?owned)\b/i;
const isGraded = (p) => GRADED.test(p.name || '');

// Every option is sold out (Ubiquiti, Sonos) or out of stock (Habitech).
function isOutOfStock(p) {
  const options = p.variants || [];
  return options.length > 0 && options.every((v) => v.status === 'SoldOut' || v.stock === 'out_of_stock');
}

// £0 means no price yet (e.g. Ubiquiti's "Coming soon" products).
const priceOfOption = (v) => (v && v.status !== 'NoPrice' && v.price > 0 ? v.price : null);

// The cheapest option ("from £…", as the Products page shows it).
function lowestPrice(p) {
  let low = null;
  for (const v of p.variants || []) {
    const price = priceOfOption(v);
    if (price != null && (low == null || price < low)) low = price;
  }
  return low;
}

// The option the product picker shows first.
function firstPrice(p) {
  return priceOfOption((p.variants || []).find((v) => v.sku === p.defaultSku)) ?? lowestPrice(p);
}

const byName = new Intl.Collator('en-GB', { sensitivity: 'base', numeric: true }).compare;

// Products without a price go last either way.
function sortProducts(list, sort, priceOf) {
  if (sort === 'name') return [...list].sort((a, b) => byName(a.name, b.name));
  if (sort !== 'price-asc' && sort !== 'price-desc') return list;
  const dir = sort === 'price-asc' ? 1 : -1;
  return list
    .map((p) => ({ p, price: priceOf(p) }))
    .sort((a, b) => (a.price == null) - (b.price == null) || dir * (a.price - b.price) || byName(a.p.name, b.p.name))
    .map((x) => x.p);
}

// For a component with `matches` (searched list), `isLive` and `live` (direct
// Habitech search) and a `sortPrice(product)` method.
const productListMixin = {
  computed: {
    view: () => productView,
    SORTS: () => SORTS,
    // What the search found, before hiding and sorting.
    found() {
      return this.isLive ? this.live.products : this.matches;
    },
    gradedCount() {
      return this.found.filter(isGraded).length;
    },
    outOfStockCount() {
      return this.found.filter(isOutOfStock).length;
    },
    shown() {
      let list = this.found;
      if (productView.hideGraded) list = list.filter((p) => !isGraded(p));
      if (productView.hideOutOfStock) list = list.filter((p) => !isOutOfStock(p));
      return sortProducts(list, productView.sort, (p) => this.sortPrice(p));
    },
    hiddenCount() {
      return this.found.length - this.shown.length;
    },
    // Which switches are hiding something from this list.
    hiddenBy() {
      return {
        hideGraded: productView.hideGraded && this.gradedCount > 0,
        hideOutOfStock: productView.hideOutOfStock && this.outOfStockCount > 0,
      };
    },
    // When everything that matches is hidden.
    hiddenNote() {
      const n = this.hiddenCount;
      const why = [this.hiddenBy.hideGraded && 'graded', this.hiddenBy.hideOutOfStock && 'out of stock'].filter(Boolean).join(' or ');
      return n === 1 ? `The only match is ${why}, so it’s hidden.` : `All ${n.toLocaleString('en-GB')} matches are ${why}, so they’re hidden.`;
    },
  },
  methods: {
    savedName,
    setView(key, value) {
      productView[key] = value;
      storageSet(VIEW_KEYS[key], typeof value === 'boolean' ? (value ? '1' : '0') : value);
    },
    showHidden() {
      for (const [key, hiding] of Object.entries(this.hiddenBy)) if (hiding) this.setView(key, false);
    },
  },
};

// ---- Live catalogues (Habitech) ---------------------------------------------------
// Too big to load into the page, so they're searched on the server as you type.

const liveStatus = reactive({}); // catalogue id → { configured, count, syncedAt, error }

async function loadLiveStatus(id) {
  if (liveStatus[id]?.loading) return;
  liveStatus[id] = { ...(liveStatus[id] || {}), loading: true };
  try {
    liveStatus[id] = { ...(await api('GET', `/api/catalogue/${id}/status`)), loading: false };
  } catch (err) {
    liveStatus[id] = { configured: true, error: err.message, loading: false };
  }
}

const isLiveSource = (id) => catalogueSources().some((s) => s.id === id && s.kind === 'live');

// The copy of a live catalogue's whole list, for browsing. Loaded when its tab
// is first opened (it's big, so other pages don't wait for it).
const liveCopies = reactive({}); // id → { loading, loaded, products, fetchedAt, refreshedAt }
const STOCK_FROM_CODE = { i: 'in_stock', l: 'low_stock', o: 'out_of_stock' };

// A compact row from the server: [sku, name, brand, mpn, category, image, cost, srp, stock, qty, description].
function liveProductFromRow(source, row, imageBase) {
  const [sku, name, brand, mpn, category, image, cost, srp, stock, qty, description] = row;
  const price = srp ?? cost;
  const img = image ? (/^https?:/.test(image) ? image : imageBase + image) : null;
  const variant = { sku, displaySku: sku, label: '', price, cost, surcharge: 0, status: 'Available', noSrp: srp == null, stock: STOCK_FROM_CODE[stock] || null, qty };
  return {
    id: `${source}:${sku}`,
    source,
    manufacturer: brand || 'Habitech',
    name,
    shortName: name,
    model: mpn || sku,
    description: description || name,
    category: category || '',
    subCategory: '',
    image: img,
    imageLarge: img,
    url: null,
    price,
    cost,
    status: 'Available',
    defaultSku: sku,
    variants: [variant],
  };
}

async function loadLiveCopy(id, force = false) {
  const c = liveCopies[id];
  if (c?.loading || (c?.loaded && !force)) return;
  liveCopies[id] = { ...(c || {}), loading: true };
  try {
    const data = await api('GET', `/api/catalogue/${id}/products`);
    // Sorted by brand, then name. Freeze the list (not each product: search
    // adds a cached index to them).
    const list = data.rows ? data.rows.map((r) => liveProductFromRow(id, r, data.imageBase || '')) : null;
    if (list) list.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name));
    const products = list ? Object.freeze(list) : null;
    liveCopies[id] = { loading: false, loaded: true, products, fetchedAt: data.fetchedAt || null, refreshedAt: data.refreshedAt || null };
  } catch (err) {
    liveCopies[id] = { ...(c || {}), loading: false, loaded: Boolean(c?.loaded), error: err.message };
  }
}

// Copy (or re-copy) a live catalogue's whole list. The server does about 40
// seconds at a time, so keep asking until it's done.
async function copyLiveCatalogue(id, restart = false) {
  if (state.catalogue.syncing) return;
  state.catalogue.syncing = id;
  const label = (catalogueSources().find((s) => s.id === id) || {}).label || id;
  try {
    for (let i = 0; i < 30; i++) {
      const s = await api('POST', `/api/catalogue/${id}/copy`, { restart: restart && i === 0 });
      liveStatus[id] = { ...s, loading: false };
      if (!s.job) break;
      if (s.busy) await new Promise((r) => setTimeout(r, 5000));
    }
    await loadLiveCopy(id, true);
    const n = liveCopies[id]?.products?.length || 0;
    toast(`${label} list ${restart ? 'copied again' : 'updated'}: ${n.toLocaleString('en-GB')} products`);
  } catch (err) {
    toast(`${label}: ${err.message}`, 'error');
    loadLiveStatus(id);
  } finally {
    state.catalogue.syncing = false;
  }
}

// "In stock (48)", "Low stock (3)", "Out of stock · due 12 December 2026".
function stockText(v) {
  if (!v || !v.stock) return '';
  const qty = v.qty != null ? ` (${v.qty})` : '';
  if (v.stock === 'in_stock') return `In stock${qty}`;
  if (v.stock === 'low_stock') return `Low stock${qty}`;
  if (v.stock === 'out_of_stock') return `Out of stock${v.restockDate ? ` · due ${formatDay(v.restockDate)}` : ''}`;
  return '';
}

// A quantity to order on Habitech's website: a whole number up to 999, or 0.
function basketQty(n) {
  const q = Math.round(Number(n));
  return q >= 1 ? Math.min(999, q) : 0;
}

const BLANK_LIVE = { key: '', products: [], total: 0, hasMore: false, loading: false, error: null, fuzzy: false, didYouMean: null };

// Search-as-you-type for a live catalogue. Used by the product picker and the
// Products page; the component provides `tab`, `q` and `source`.
const liveSearchMixin = {
  data() {
    return { live: { ...BLANK_LIVE }, loadingOptions: null };
  },
  computed: {
    isLiveTab() {
      return this.source?.kind === 'live';
    },
    // The copied list of everything, once it has loaded.
    copy() {
      return this.isLiveTab ? liveCopies[this.tab] || null : null;
    },
    hasCopy() {
      return Boolean(this.copy?.products?.length);
    },
    copyLoading() {
      return this.isLiveTab && Boolean(this.copy?.loading) && !this.copy?.loaded;
    },
    // Search Habitech directly: when there's no copy yet, or nothing in the
    // copy matches what was typed.
    isLive() {
      if (!this.isLiveTab || this.copyLoading) return false;
      if (!this.hasCopy) return true;
      return this.q.trim().length >= 2 && !this.category && !this.matches.length;
    },
    // Live catalogues are filtered by brand; the others by category.
    filterKey() {
      return this.isLiveTab ? 'manufacturer' : 'category';
    },
    filterLabel() {
      return this.isLiveTab ? 'All brands' : this.tab === 'crestron' ? 'All ranges' : 'All categories';
    },
    liveInfo() {
      return liveStatus[this.tab] || null;
    },
  },
  watch: {
    q() {
      if (this.isLive) this.queueLiveSearch();
    },
    isLive(on) {
      if (on) this.queueLiveSearch(0);
    },
    tab() {
      if (!this.isLiveTab) return;
      loadLiveStatus(this.tab);
      loadLiveCopy(this.tab);
      this.live = { ...BLANK_LIVE };
      if (this.isLive) this.queueLiveSearch(0);
    },
  },
  beforeUnmount() {
    clearTimeout(this.liveTimer);
  },
  methods: {
    stockText,
    queueLiveSearch(delay = 300) {
      clearTimeout(this.liveTimer);
      this.liveTimer = setTimeout(() => this.runLiveSearch(), delay);
    },
    async runLiveSearch(more = false) {
      const id = this.tab;
      const q = this.q.trim();
      const key = `${id}|${q.toLowerCase()}`;
      if (q.length < 2) {
        this.liveSeq = (this.liveSeq || 0) + 1;
        this.live = { ...BLANK_LIVE, key };
        return;
      }
      if (!more && key === this.live.key && !this.live.error) return;
      const seq = (this.liveSeq = (this.liveSeq || 0) + 1);
      const offset = more ? this.live.products.length : 0;
      this.live.key = key;
      this.live.loading = true;
      this.live.error = null;
      try {
        const r = await api('GET', `/api/catalogue/${id}/search?q=${encodeURIComponent(q)}&offset=${offset}`);
        if (seq !== this.liveSeq) return; // a newer search has started
        Object.assign(this.live, {
          products: more ? [...this.live.products, ...r.products] : r.products,
          total: r.total,
          hasMore: r.hasMore,
          fuzzy: r.fuzzy,
          didYouMean: r.didYouMean,
        });
      } catch (err) {
        if (seq !== this.liveSeq) return;
        this.live.error = err.message;
        if (!more) this.live.products = [];
      } finally {
        if (seq === this.liveSeq) this.live.loading = false;
      }
    },
    // Products sold in options (e.g. cable colours): fetch the options.
    async loadOptions(p) {
      this.loadingOptions = p.id;
      try {
        const { product } = await api('GET', `/api/catalogue/${p.source}/products/${encodeURIComponent(p.defaultSku)}`);
        const i = this.live.products.indexOf(p);
        if (i >= 0) this.live.products.splice(i, 1, product);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        this.loadingOptions = null;
      }
    },
  },
};

// ---- Product picker -------------------------------------------------------------

const ProductPicker = {
  components: { Modal, MoneyInput },
  mixins: [liveSearchMixin, productListMixin],
  props: { sectionName: String, quote: Object },
  emits: ['add', 'close'],
  data() {
    return {
      tab: 'ubiquiti',
      q: '',
      category: '',
      variants: {},
      qtys: {},
      added: 0,
      limit: 40,
      manual: this.blankManual(),
    };
  },
  computed: {
    STATUS_BADGE: () => STATUS_BADGE,
    cat() {
      return state.catalogue;
    },
    catalogues: () => catalogueSources(),
    // The catalogue on the current tab (Ubiquiti, Sonos, Crestron), if any.
    source() {
      return this.catalogues.find((s) => s.id === this.tab) || null;
    },
    pool() {
      if (this.isLiveTab) return this.copy?.products || [];
      return this.cat.products.filter((p) => p.source === this.tab);
    },
    categories() {
      return [...new Set(this.pool.map((p) => p[this.filterKey]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    },
    matches() {
      return searchProducts(this.pool, this.q, this.category, this.filterKey, toRaw(productNames.map));
    },
    results() {
      return this.isLive ? this.shown : this.shown.slice(0, this.limit);
    },
    searchHint() {
      return SEARCH_HINTS[this.tab] || `Search ${this.source ? this.source.label : ''} products`;
    },
    // How this quote works out our cost for Ubiquiti and Sonos products.
    tradeDiscountText() {
      const q = this.quote || {};
      if (this.tab === 'ubiquiti') return Number(q.costDiscount) ? `our cost is the store price less ${q.costDiscount}%` : '';
      if (this.tab !== 'sonos') return '';
      const d = q.sonosCostDiscount;
      return d === null || d === undefined || d === '' ? 'our cost isn’t known: set the Sonos discount under Pricing & terms, or type it on the line' : `our cost is the Sonos price less ${d}%`;
    },
    kits() {
      const q = this.q.trim().toLowerCase();
      return state.kits.list.filter((k) => !q || [k.name, k.description, ...k.items.map((i) => i.name)].join(' ').toLowerCase().includes(q));
    },
    kitsLoaded: () => state.kits.loaded,
  },
  watch: {
    q() {
      this.limit = 40;
    },
    category() {
      this.limit = 40;
    },
    'view.sort'() {
      this.limit = 40;
    },
    tab() {
      this.category = '';
      this.limit = 40;
      if (this.tab !== 'manual') nextTick(() => this.$refs.search?.focus());
    },
  },
  mounted() {
    loadCatalogue();
    loadKits();
    loadProductNames();
    nextTick(() => this.$refs.search?.focus());
  },
  methods: {
    ...sharedMethods,
    sortPrice: firstPrice,
    // A kit's items priced with this quote's rates and today's catalogue prices.
    kitItems(kit) {
      const prices = storePriceIndex();
      return freshItems(kit.items).map((item) => withCurrentPrice(item, prices));
    },
    formatDay,
    kitTotal(kit) {
      return this.kitItems(kit).reduce((s, i) => s + C.itemTotals(i, this.quote).total, 0);
    },
    kitSummary(kit) {
      const products = kit.items.filter((i) => i.kind !== 'labour');
      const labour = kit.items.reduce((h, i) => h + C.itemTotals(i, this.quote).labourHours, 0);
      const names = products.slice(0, 4).map((i) => `${i.qty} × ${i.name}`);
      if (products.length > 4) names.push(`${products.length - 4} more`);
      if (labour) names.push(`${hours(labour)} labour`);
      return names.join(' · ');
    },
    addKit(kit) {
      const items = this.kitItems(kit);
      for (const item of items) this.$emit('add', item);
      this.added += items.length;
      toast(`Added kit “${kit.name}” (${items.length} line${items.length === 1 ? '' : 's'})`);
    },
    blankManual() {
      return { manufacturer: '', name: '', model: '', description: '', price: null, cost: null, image: '', qty: 1, save: true };
    },
    variantOf(p) {
      const sku = this.variants[p.id] || p.defaultSku;
      return p.variants.find((v) => v.sku === sku) || p.variants[0];
    },
    qtyOf(p) {
      return this.qtys[p.id] ?? 1;
    },
    async add(p) {
      let v = this.variantOf(p);
      const qty = this.qtyOf(p);
      if (!productNames.loaded) await loadProductNames();
      // The copied list is up to a day old: add Habitech products at today's price.
      if (isLiveSource(p.source) && this.hasCopy && !this.isLive) {
        try {
          const { prices } = await api('POST', `/api/catalogue/${p.source}/prices`, { skus: [v.sku] });
          const now = prices[v.sku];
          if (now && now.status !== 'NoPrice') v = { ...v, price: now.price, cost: now.cost, stock: now.stock, qty: now.qty };
        } catch {
          /* add at the copied price; the quote checks it again */
        }
      }
      const item = itemFromProduct(p, v, qty);
      this.$emit('add', item);
      this.added += item.qty;
      toast(`Added ${item.qty} × ${item.name}`);
      this.qtys[p.id] = 1;
    },
    async addManual() {
      const m = this.manual;
      if (!m.name.trim()) return toast('Give the item a name first', 'error');
      if (m.save) {
        try {
          await api('POST', '/api/products/custom', m);
          loadCatalogue(true);
        } catch (err) {
          toast(`Could not save to Our products: ${err.message}`, 'error');
        }
      }
      const item = {
        id: uid(),
        kind: 'product',
        source: 'manual',
        productId: null,
        manufacturer: m.manufacturer.trim() || 'Other',
        name: m.name.trim(),
        model: m.model.trim(),
        sku: m.model.trim(),
        variantLabel: '',
        description: m.description.trim(),
        image: m.image.trim() || null,
        url: null,
        basePrice: m.price || 0,
        surcharge: 0,
        costPrice: m.cost,
        priceOverride: null,
        discount: 0,
        qty: Math.max(1, Number(m.qty) || 1),
        labour: [],
      };
      this.$emit('add', item);
      this.added += item.qty;
      toast(`Added ${item.qty} × ${item.name}`);
      this.manual = this.blankManual();
    },
  },
  template: `
  <Modal :title="'Add to ' + (sectionName || 'area')" wide @close="$emit('close')">
    <div class="picker">
      <div class="tabs" v-tab-ink>
        <button v-for="s in catalogues" :key="s.id" :class="{ active: tab === s.id }" @click="tab = s.id">{{ s.label }}</button>
        <button :class="{ active: tab === 'custom' }" @click="tab = 'custom'">Our products</button>
        <button :class="{ active: tab === 'kits' }" @click="tab = 'kits'">Kits <span class="count" v-if="kitsLoaded">{{ kits.length }}</span></button>
        <button :class="{ active: tab === 'manual' }" @click="tab = 'manual'">One-off item</button>
      </div>

      <template v-if="tab === 'kits'">
        <input ref="search" class="search" type="search" v-model="q" placeholder="Search kits">
        <p class="picker-meta">A kit adds a saved group of items and their labour in one go. To make one, build an area, then click <b>Save as kit</b> under it.</p>
        <div v-if="!kitsLoaded" class="empty">Loading kits…</div>
        <div v-else-if="!kits.length" class="empty">{{ q ? 'No kits match “' + q + '”.' : 'No kits yet.' }}</div>
        <ul class="results" v-else>
          <li v-for="k in kits" :key="k.id" class="result kit-result">
            <div class="thumb kit-thumb"><span></span><span></span><span></span></div>
            <div class="r-main">
              <div class="r-name">{{ k.name }}</div>
              <div class="r-sub">{{ k.items.length }} line{{ k.items.length === 1 ? '' : 's' }}</div>
              <div class="r-desc" v-if="k.description">{{ k.description }}</div>
              <div class="r-desc muted">{{ kitSummary(k) }}</div>
            </div>
            <div class="r-price"><div class="price">{{ money(kitTotal(k)) }}</div><div class="surcharge">ex VAT, today's prices</div></div>
            <div class="r-add"><button class="btn primary" @click="addKit(k)">Add kit</button></div>
          </li>
        </ul>
      </template>

      <template v-else-if="tab !== 'manual'">
        <div class="picker-filters" :class="{ 'search-only': isLiveTab && !hasCopy }">
          <input ref="search" class="search" type="search" v-model="q" :placeholder="searchHint">
          <select v-if="!isLiveTab || hasCopy" v-model="category">
            <option value="">{{ filterLabel }}</option>
            <option v-for="c in categories" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="list-tools">
          <label class="sort-by">Sort
            <select :value="view.sort" @change="setView('sort', $event.target.value)" aria-label="Sort products">
              <option v-for="(label, key) in SORTS" :value="key">{{ label }}</option>
            </select>
          </label>
          <button v-if="gradedCount || view.hideGraded" type="button" class="chip toggle" :class="{ active: view.hideGraded }" :aria-pressed="view.hideGraded" @click="setView('hideGraded', !view.hideGraded)" title="Graded, ex-display and refurbished stock">Hide graded stock <span>{{ gradedCount.toLocaleString('en-GB') }}</span></button>
          <button v-if="outOfStockCount || view.hideOutOfStock" type="button" class="chip toggle" :class="{ active: view.hideOutOfStock }" :aria-pressed="view.hideOutOfStock" @click="setView('hideOutOfStock', !view.hideOutOfStock)">Hide out of stock <span>{{ outOfStockCount.toLocaleString('en-GB') }}</span></button>
          <span class="sort-note" v-if="isLive && live.hasMore && view.sort !== 'match'">Sorts the {{ live.products.length }} shown so far</span>
        </div>

        <p class="picker-meta" v-if="isLiveTab && hasCopy && !isLive">
          All {{ pool.length.toLocaleString('en-GB') }} {{ source.label }} products · price is the SRP and our cost is our trade price, both ex VAT · today’s price is checked as you add<template v-if="q || category || hiddenCount"> · {{ shown.length.toLocaleString('en-GB') }} {{ q || category ? 'match' + (shown.length === 1 ? '' : 'es') : 'shown' }}</template>
        </p>
        <p class="picker-meta" v-else-if="isLive && hasCopy">Nothing in the {{ source.label }} list matches, so these come straight from {{ source.label }}<template v-if="live.products.length"> · {{ live.total.toLocaleString('en-GB') }} match{{ live.total === 1 ? '' : 'es' }}</template></p>
        <p class="picker-meta" v-else-if="isLive && source.configured !== false">
          Live from {{ source.label }}<template v-if="liveInfo && liveInfo.count"> ({{ liveInfo.count.toLocaleString('en-GB') }} products)</template> · price is the SRP and our cost is our trade price, both ex VAT<template v-if="live.products.length"> · {{ live.total.toLocaleString('en-GB') }} match{{ live.total === 1 ? '' : 'es' }}</template>
        </p>

        <p class="picker-meta" v-if="source && source.kind === 'web'">
          <template v-if="cat.syncing === source.id || source.syncing">Updating from the {{ source.tabName }}…</template>
          <template v-else-if="source.fetchedAt">Prices from the {{ source.tabName }}, ex VAT · updated {{ timeAgo(source.fetchedAt) }}<template v-if="tradeDiscountText"> · {{ tradeDiscountText }}</template></template>
          <template v-else-if="cat.loaded">No {{ source.label }} prices yet — refresh on the Products page.</template>
        </p>
        <p class="picker-meta" v-else-if="source && source.kind === 'import' && source.count">
          MSRP from the {{ source.label }} price list<template v-if="source.priceListDate"> dated {{ formatDay(source.priceListDate) }}</template>, ex VAT · our cost (dealer price) is filled in for the profit figure
        </p>

        <div v-if="isLiveTab && source.configured === false" class="empty">
          {{ source.label }} isn’t connected yet. Add the API key from {{ source.label }} as <b>HABITECH_API_KEY</b> in Vercel → Settings → Environment Variables, then redeploy.
        </div>
        <div v-else-if="copyLoading" class="empty loading">Loading {{ source.label }} products…</div>
        <div v-else-if="isLive && live.error" class="empty error-text">{{ live.error }}</div>
        <div v-else-if="isLive && live.loading && !live.products.length" class="empty loading">Searching {{ source.label }}…</div>
        <div v-else-if="isLive && !results.length" class="empty">
          <template v-if="q.trim().length < 2">Type a product name, brand or part code to search {{ source.label }}<template v-if="liveInfo && liveInfo.count">’s {{ liveInfo.count.toLocaleString('en-GB') }} products</template>.</template>
          <template v-else-if="hiddenCount">{{ hiddenNote }} <button class="link" @click="showHidden">Show {{ hiddenCount === 1 ? 'it' : 'them' }}</button></template>
          <template v-else>Nothing at {{ source.label }} matches “{{ q }}”.</template>
        </div>
        <div v-else-if="cat.loading && !cat.loaded && !isLiveTab" class="empty loading">Loading products…</div>
        <div v-else-if="!results.length" class="empty">
          <template v-if="tab === 'custom' && !pool.length">No saved products yet. Use <b>One-off item</b> and tick “Save to Our products”, or add them on the Products page.</template>
          <template v-else-if="source && source.kind === 'import' && !pool.length">No {{ source.label }} price list yet. Import it on the <a href="#/products" @click="$emit('close')">Products page</a>.</template>
          <template v-else-if="source && !pool.length">No {{ source.label }} products yet — refresh on the Products page.</template>
          <template v-else-if="hiddenCount">{{ hiddenNote }} <button class="link" @click="showHidden">Show {{ hiddenCount === 1 ? 'it' : 'them' }}</button></template>
          <template v-else>No products match “{{ q }}”.</template>
        </div>

        <ul class="results" v-else :class="{ refreshing: isLive && live.loading }">
          <li v-if="isLive && live.fuzzy" class="picker-meta fuzzy-note">No exact match, so these are the closest<template v-if="live.didYouMean">. Did you mean “{{ live.didYouMean }}”?</template></li>
          <li v-for="p in results" :key="p.id" class="result">
            <div class="thumb"><img v-if="p.image" :src="p.image" alt="" loading="lazy"></div>
            <div class="r-main">
              <div class="r-name">{{ p.name }}</div>
              <div class="saved-as" v-if="savedName(p.id)">Added as “{{ savedName(p.id) }}”</div>
              <div class="r-sub">{{ p.manufacturer }} · {{ variantOf(p).sku || p.model }}<span v-if="p.subCategory"> · {{ p.category }} / {{ p.subCategory }}</span><span v-else-if="p.category && p.source !== 'custom'"> · {{ p.category }}</span></div>
              <div class="r-desc" v-if="p.description && p.description !== p.name">{{ p.description }}</div>
              <select v-if="p.variants.length > 1" class="variant" :value="variantOf(p).sku" @change="variants[p.id] = $event.target.value" aria-label="Option">
                <option v-for="v in p.variants" :value="v.sku">{{ v.label || v.sku }} — {{ money(v.price) }}{{ v.status !== 'Available' ? ' (' + (STATUS_BADGE[v.status] || v.status) + ')' : '' }}</option>
              </select>
              <div class="stock" v-if="stockText(variantOf(p))" :class="variantOf(p).stock">{{ stockText(variantOf(p)) }}</div>
            </div>
            <div class="r-price">
              <template v-if="variantOf(p).status !== 'NoPrice'">
                <div class="price">{{ money(variantOf(p).price) }}</div>
                <div class="surcharge" v-if="variantOf(p).surcharge">+ {{ money(variantOf(p).surcharge) }} surcharge</div>
                <div class="surcharge" v-if="(variantOf(p).cost ?? p.cost) != null && p.source !== 'custom'">our cost {{ money(variantOf(p).cost ?? p.cost) }}</div>
                <div class="surcharge" v-if="variantOf(p).noSrp">no SRP, so priced at cost</div>
              </template>
              <span class="badge warn" v-if="STATUS_BADGE[variantOf(p).status]">{{ STATUS_BADGE[variantOf(p).status] }}</span>
              <span class="badge warn" v-if="p.status === 'Discontinued' && variantOf(p).status !== 'Discontinued'">Discontinued<template v-if="p.replacementSku"> · now {{ p.replacementSku }}</template></span>
            </div>
            <div class="r-add">
              <template v-if="p.hasOptions">
                <button class="btn" @click="loadOptions(p)" :disabled="loadingOptions === p.id">{{ loadingOptions === p.id ? 'Loading…' : 'Choose option' }}</button>
              </template>
              <template v-else>
                <input type="number" min="1" step="1" :value="qtyOf(p)" @input="qtys[p.id] = Math.max(1, parseInt($event.target.value) || 1)" aria-label="Quantity">
                <button class="btn primary" @click="add(p)" :disabled="variantOf(p).status === 'NoPrice'" :title="variantOf(p).status === 'NoPrice' ? 'Habitech has no trade price for this on our account. Email Habitech to add pricing for this brand.' : ''">Add</button>
              </template>
            </div>
          </li>
          <li v-if="!isLive && shown.length > results.length" class="more">
            <button class="btn ghost" @click="limit += 40">Show more ({{ (shown.length - results.length).toLocaleString('en-GB') }} more)</button>
          </li>
          <li v-if="isLive && live.hasMore" class="more">
            <button class="btn ghost" @click="runLiveSearch(true)" :disabled="live.loading">{{ live.loading ? 'Loading…' : 'Show more (' + (live.total - results.length).toLocaleString('en-GB') + ' more)' }}</button>
          </li>
        </ul>
      </template>

      <form v-else class="manual form-grid" @submit.prevent="addManual">
        <p class="hint span-2">For anything not in the catalogues — other manufacturers, cable, sundries.</p>
        <label>Manufacturer<input v-model="manual.manufacturer" placeholder="e.g. Lutron"></label>
        <label>Model / SKU<input v-model="manual.model" placeholder="e.g. RRST-PRO-N-WH"></label>
        <label class="span-2">Product name<input v-model="manual.name" placeholder="e.g. Lutron RadioRA 3 dimmer" required></label>
        <label class="span-2">Description (shown to the client)<textarea v-model="manual.description" rows="2"></textarea></label>
        <label>Unit price (ex VAT)<MoneyInput v-model="manual.price" /></label>
        <label>Our cost (optional, internal)<MoneyInput v-model="manual.cost" /></label>
        <label class="span-2">Image URL (optional)<input v-model="manual.image" placeholder="https://…"></label>
        <label>Quantity<input type="number" min="1" v-model.number="manual.qty"></label>
        <label class="check"><input type="checkbox" v-model="manual.save"> Save to Our products for next time</label>
        <div class="span-2"><button class="btn primary" type="submit">Add item</button></div>
      </form>
    </div>
    <template #footer>
      <span class="muted">{{ added ? added + ' added to ' + (sectionName || 'this area') : 'Add as many as you like, then click Done.' }}</span>
      <button class="btn" @click="$emit('close')">Done</button>
    </template>
  </Modal>`,
};

// ---- Quotes list --------------------------------------------------------------

const QuotesList = {
  data() {
    return { quotes: [], loading: true, search: '', status: 'all' };
  },
  computed: {
    settings() {
      return state.settings;
    },
    filtered() {
      const q = this.search.trim().toLowerCase();
      return this.quotes.filter(
        (x) =>
          (this.status === 'all' || x.status === this.status) &&
          (!q || [x.number, x.title, x.client, x.preparedBy].join(' ').toLowerCase().includes(q)),
      );
    },
    counts() {
      const c = { all: this.quotes.length, draft: 0, sent: 0, changes: 0, accepted: 0, declined: 0 };
      for (const q of this.quotes) c[q.status] = (c[q.status] || 0) + 1;
      return c;
    },
    chipKeys() {
      // Only show "Changes requested" when there are some.
      return ['all', ...STATUS_KEYS.filter((k) => k !== 'changes' || this.counts.changes)];
    },
    pipeline() {
      return this.quotes.filter((q) => q.status === 'sent' || q.status === 'changes').reduce((s, q) => s + q.subtotal, 0);
    },
    won() {
      return this.quotes.filter((q) => q.status === 'accepted').reduce((s, q) => s + q.subtotal, 0);
    },
  },
  async mounted() {
    try {
      this.quotes = await api('GET', '/api/quotes');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      this.loading = false;
    }
  },
  methods: {
    ...sharedMethods,
    statusLabel: (s) => STATUS_LABELS[s] || s,
    // e.g. "Opened 3 times · 2 hr ago", or the client's reply.
    activityLine(q) {
      if (q.response && REPLY_STATUS[q.response.action] === q.status) return `${q.response.name} replied online · ${timeAgo(q.response.at)}`;
      if (q.views) return `Opened ${q.views === 1 ? 'once' : q.views + ' times'} · ${timeAgo(q.lastViewed)}`;
      if (q.status === 'sent') return 'Not opened yet';
      return '';
    },
    open(q) {
      location.hash = `#/quote/${q.id}`;
    },
    async create() {
      try {
        const q = await api('POST', '/api/quotes', { preparedBy: state.me });
        location.hash = `#/quote/${q.id}`;
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    async duplicate(q) {
      try {
        const copy = await api('POST', `/api/quotes/${q.id}/duplicate`);
        location.hash = `#/quote/${copy.id}`;
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    async remove(q) {
      if (!confirm(`Delete ${q.number} “${q.title}”? This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/quotes/${q.id}`);
        this.quotes = this.quotes.filter((x) => x.id !== q.id);
        toast(`Deleted ${q.number}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  },
  template: `
  <div class="page">
    <div class="page-head">
      <MeshBand />
      <div>
        <p class="eyebrow">Proposals</p>
        <h1>Quotes</h1>
        <p class="muted">Build proposals from the Ubiquiti UK catalogue and your own products.</p>
      </div>
      <button class="btn primary lg" @click="create">+ New quote</button>
    </div>

    <div class="notice" v-if="settings && !settings.team.length">
      Add your names in <a href="#/settings">Settings</a> so they can appear as “Prepared by” on proposals.
    </div>

    <div class="stats" v-if="quotes.length">
      <div class="stat"><span>Quotes</span><b><AnimatedNumber :value="quotes.length" from-zero /></b></div>
      <div class="stat"><span>Sent, awaiting reply</span><b><AnimatedNumber :value="pipeline" money from-zero /></b><small>ex VAT</small></div>
      <div class="stat"><span>Accepted</span><b><AnimatedNumber :value="won" money from-zero /></b><small>ex VAT</small></div>
    </div>

    <div class="toolbar-row" v-if="quotes.length">
      <div class="chips">
        <button v-for="s in chipKeys" :key="s" class="chip" :class="{ active: status === s }" @click="status = s">
          {{ s === 'all' ? 'All' : statusLabel(s) }} <span>{{ counts[s] || 0 }}</span>
        </button>
      </div>
      <input class="search sm" type="search" v-model="search" placeholder="Search quotes">
    </div>

    <div class="card" v-if="loading"><div class="empty loading">Loading…</div></div>
    <div class="card empty-state" v-else-if="!quotes.length">
      <div class="es-mark"></div>
      <h2>No quotes yet</h2>
      <p class="muted">Start a quote, add Ubiquiti equipment, add labour, write your scope and send a branded proposal.</p>
      <button class="btn primary lg" @click="create">+ New quote</button>
    </div>
    <div class="card table-card" v-else>
      <table class="list">
        <thead><tr><th>Ref</th><th>Proposal</th><th>Prepared by</th><th>Status</th><th class="num">Total ex VAT</th><th>Updated</th><th></th></tr></thead>
        <TransitionGroup tag="tbody" name="qrow">
          <tr v-for="q in filtered" :key="q.id" @click="open(q)" class="click">
            <td class="ref">{{ q.number }}</td>
            <td><div class="strong">{{ q.title }}</div><div class="muted sm">{{ q.client || 'No client yet' }} · {{ q.items }} line{{ q.items === 1 ? '' : 's' }}</div></td>
            <td>{{ q.preparedBy || '—' }}</td>
            <td><span class="pill" :class="q.status">{{ statusLabel(q.status) }}</span><div class="activity-line" :class="{ fresh: q.response && q.status !== 'sent' }" v-if="activityLine(q)">{{ activityLine(q) }}</div></td>
            <td class="num strong">{{ money(q.subtotal) }}</td>
            <td class="muted">{{ timeAgo(q.updatedAt) }}</td>
            <td class="actions" @click.stop>
              <a class="btn ghost sm" :href="'/p/' + q.id" target="_blank" rel="noopener">View</a>
              <button class="btn ghost sm" @click="duplicate(q)">Copy</button>
              <button class="btn ghost sm danger" @click="remove(q)">Delete</button>
            </td>
          </tr>
          <tr v-if="!filtered.length" key="none"><td colspan="7" class="empty">No quotes match.</td></tr>
        </TransitionGroup>
      </table>
    </div>
  </div>`,
};

// ---- Quote editor ------------------------------------------------------------

const QuoteEditor = {
  components: { MoneyInput, AutoTextarea, ProductPicker, Modal },
  props: { id: String },
  data() {
    return {
      quote: null,
      loadError: null,
      baseUpdatedAt: null,
      saveState: 'saved',
      saving: null,
      conflict: null,
      tab: 'items',
      pickerSection: null,
      labourOpen: {},
      descOpen: {},
      discOpen: {},
      costOpen: {},
      renamed: {}, // lines renamed since the quote was opened
      activity: null,
      revisions: null,
      compareN: null,
      versionNote: '',
      savingVersion: false,
      kitDraft: null,
      hideProfit: storageGet('mesh.hideProfit') === '1',
      livePrices: {}, // today's Habitech price, cost and stock, keyed like priceKey()
      basket: null, // the "Add to Habitech basket" window
    };
  },
  computed: {
    STATUS_LABELS: () => STATUS_LABELS,
    REPLY_LABELS: () => REPLY_LABELS,
    VERSION_KINDS: () => VERSION_KINDS,
    settings() {
      return state.settings;
    },
    totals() {
      return this.quote ? C.quoteTotals(this.quote) : null;
    },
    // The client's reply, while the quote still shows the result of it.
    reply() {
      const r = this.quote?.clientResponse;
      return r && REPLY_STATUS[r.action] === this.quote.status ? r : null;
    },
    marginClass() {
      const m = this.totals?.margin || 0;
      return m < 0 ? 'loss' : m < 10 ? 'thin' : 'ok';
    },
    versions() {
      return this.revisions ? [...this.revisions].reverse() : [];
    },
    session: () => state.session,
    conflictByClient() {
      return Boolean(this.conflict?.clientResponse?.id && this.conflict.clientResponse.id !== this.quote?.clientResponse?.id);
    },
    // Client views and replies, newest first.
    timeline() {
      if (!this.activity) return [];
      const replies = this.activity.responses.map((r) => ({
        kind: r.action,
        at: r.at,
        title: `${REPLY_LABELS[r.action]} by ${r.name}`,
        detail: [r.po ? `PO ${r.po}` : '', r.email, r.message ? `“${r.message}”` : ''].filter(Boolean).join(' · '),
      }));
      const views = this.activity.views.recent.map((v) => ({ kind: 'view', at: v.at, title: `Opened on a ${v.device}`, detail: '' }));
      return [...replies, ...views].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 25);
    },
    comparison() {
      if (!this.compareN || !this.revisions) return null;
      const rev = this.revisions.find((r) => r.n === this.compareN);
      return rev ? { rev, ...diffQuotes(rev.quote, this.quote) } : null;
    },
    team() {
      return (this.settings?.team || []).map((m) => m.name).filter(Boolean);
    },
    pickerSectionName() {
      return this.quote?.sections.find((s) => s.id === this.pickerSection)?.name;
    },
    // Current store prices by SKU, to spot lines whose price has changed.
    priceIndex() {
      return { ...storePriceIndex(), ...this.livePrices };
    },
    // The quote's lines from live catalogues (Habitech), whose prices we ask for.
    liveKeys() {
      if (!this.quote) return '';
      const keys = new Set();
      for (const s of this.quote.sections) for (const i of s.items) if (i.kind !== 'labour' && i.sku && isLiveSource(i.source)) keys.add(priceKey(i));
      return [...keys].sort().join('\n');
    },
    // The quote's Habitech products, each part code once with its total
    // quantity and the areas it's in.
    habitechLines() {
      if (!this.quote) return [];
      const rows = new Map();
      for (const s of this.quote.sections) {
        for (const item of s.items) {
          if (item.kind === 'labour' || item.source !== 'habitech' || !item.sku) continue;
          const key = item.sku.toUpperCase();
          if (!rows.has(key)) rows.set(key, { sku: item.sku, item, qty: 0, areas: [] });
          const row = rows.get(key);
          row.qty += Math.max(0, Math.ceil(Number(item.qty) || 0));
          if (s.name && !row.areas.includes(s.name)) row.areas.push(s.name);
        }
      }
      return [...rows.values()];
    },
    basketRows() {
      return this.basket ? this.basket.rows.filter((r) => r.id) : [];
    },
    // The front cover tick box. Quotes made before the front cover existed
    // follow their old "Separate cover page" setting until it's changed
    // (the same rule as the proposal, in lib/proposal.js).
    frontCover: {
      get() {
        const own = this.quote.display || {};
        return typeof own.frontCover === 'boolean' ? own.frontCover : own.coverPage === true;
      },
      set(on) {
        this.quote.display.frontCover = on;
      },
    },
    basketMissing() {
      return this.basket ? this.basket.rows.filter((r) => r.state === 'missing') : [];
    },
    basketUnchecked() {
      return this.basket ? this.basket.rows.filter((r) => r.state === 'unchecked') : [];
    },
    basketPicked() {
      return this.basketRows.filter((r) => r.pick && basketQty(r.order));
    },
    basketItems() {
      return this.basketPicked.reduce((n, r) => n + basketQty(r.order), 0);
    },
    // Opening this adds the ticked products to the basket on Habitech's website.
    basketLink() {
      if (!this.basket?.link || !this.basketPicked.length) return '';
      return this.basket.link + this.basketPicked.map((r) => `${r.id},${basketQty(r.order)}`).join(';');
    },
    changedPrices() {
      if (!this.quote || !state.catalogue.loaded) return [];
      const out = [];
      for (const s of this.quote.sections) {
        for (const item of s.items) {
          const now = this.storePriceChange(item);
          if (now) out.push({ item, now });
        }
      }
      return out;
    },
    validUntil() {
      if (!this.quote?.date) return '';
      const d = new Date(`${this.quote.date}T12:00:00`);
      d.setDate(d.getDate() + (Number(this.quote.validDays) || 0));
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    },
    pdfLabel() {
      return state.session?.pdf === 'print' ? 'Save as PDF' : 'Download PDF';
    },
    saveLabel() {
      return { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved — retrying when you edit', conflict: 'Not saved' }[this.saveState];
    },
  },
  watch: {
    quote: {
      deep: true,
      handler() {
        if (this.skipWatch) {
          this.skipWatch = false;
          return;
        }
        this.scheduleSave();
      },
    },
    tab(t) {
      if (t === 'history') {
        this.loadRevisions();
        this.loadActivity();
      }
    },
    liveKeys() {
      clearTimeout(this.liveTimer);
      this.liveTimer = setTimeout(() => this.loadLivePrices(), 400);
    },
  },
  async mounted() {
    loadCatalogue();
    loadProductNames();
    try {
      const quote = await api('GET', `/api/quotes/${this.id}`);
      this.setQuote(quote);
      this.loadActivity();
    } catch (err) {
      this.loadError = err.message;
    }
    this.onUnload = (e) => {
      if (this.saveState !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', this.onUnload);
    // Coming back to the tab: check whether the client has opened or replied.
    this.onVisible = () => document.visibilityState === 'visible' && this.quote && this.loadActivity();
    document.addEventListener('visibilitychange', this.onVisible);
  },
  beforeUnmount() {
    window.removeEventListener('beforeunload', this.onUnload);
    document.removeEventListener('visibilitychange', this.onVisible);
    clearTimeout(this.liveTimer);
    if (this.saveState === 'unsaved') this.saveNow();
  },
  methods: {
    ...sharedMethods,
    statusLabel: (s) => STATUS_LABELS[s] || s,
    pct: (n) => `${Math.round((Number(n) || 0) * 10) / 10}%`,
    setQuote(quote) {
      // Older or hand-edited quotes may be missing fields.
      quote.sections ||= [];
      quote.scope ||= [];
      quote.display ||= {};
      quote.display.layout ||= 'detailed';
      quote.display.labourPlacement ||= state.settings?.display?.labourPlacement || 'area';
      quote.client ||= {};
      quote.discount ||= { type: 'none', percent: null, amount: null, label: '' };
      quote.costDiscount ??= 0;
      // A quote without its own Sonos discount picks up the one in Settings.
      if (quote.sonosCostDiscount == null || quote.sonosCostDiscount === '') quote.sonosCostDiscount = state.settings?.sonosCostDiscount ?? null;
      for (const s of quote.sections) for (const i of s.items) if (i.kind !== 'labour') i.labour ||= [];
      this.skipWatch = true;
      this.quote = quote;
      this.baseUpdatedAt = quote.updatedAt;
      this.saveState = 'saved';
    },
    scheduleSave() {
      if (this.saveState === 'conflict') return;
      this.saveState = 'unsaved';
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.saveNow(), 700);
    },
    async saveNow() {
      clearTimeout(this.saveTimer);
      if (this.saving) await this.saving;
      if (!this.quote || !['unsaved', 'error'].includes(this.saveState)) return;
      this.saveState = 'saving';
      const payload = clone(this.quote);
      this.saving = api('PUT', `/api/quotes/${this.quote.id}`, { quote: payload, baseUpdatedAt: this.baseUpdatedAt })
        .then((saved) => {
          this.baseUpdatedAt = saved.updatedAt;
          if (this.saveState === 'saving') this.saveState = 'saved';
        })
        .catch((err) => {
          if (err.status === 409) {
            this.conflict = err.data.current;
            this.saveState = 'conflict';
          } else {
            this.saveState = 'error';
            toast(`Could not save: ${err.message}`, 'error');
          }
        })
        .finally(() => {
          this.saving = null;
        });
      await this.saving;
    },
    useTheirs() {
      this.setQuote(this.conflict);
      this.conflict = null;
      toast('Loaded the latest version');
    },
    keepMine() {
      // If the client replied in the meantime, keep the status their reply set.
      if (this.conflict.clientResponse?.id && this.conflict.clientResponse.id !== this.quote.clientResponse?.id) {
        this.quote.status = this.conflict.status;
        this.quote.clientResponse = this.conflict.clientResponse;
      }
      this.baseUpdatedAt = this.conflict.updatedAt;
      this.conflict = null;
      this.saveState = 'unsaved';
      this.saveNow();
    },
    async loadActivity() {
      try {
        const activity = await api('GET', `/api/quotes/${this.quote.id}/activity`);
        const latest = activity.responses[0];
        const isNew = this.activity && latest && latest.id !== this.activity.responses[0]?.id;
        this.activity = activity;
        // The client replied while this was open: show their reply now.
        if (latest && latest.id !== this.quote.clientResponse?.id && this.saveState === 'saved' && !this.saving) {
          this.setQuote(await api('GET', `/api/quotes/${this.quote.id}`));
          if (isNew) toast(`${REPLY_LABELS[latest.action]} by ${latest.name}`);
          if (this.revisions) this.loadRevisions();
        }
      } catch {
        /* not important enough to interrupt */
      }
    },
    async loadRevisions() {
      try {
        this.revisions = await api('GET', `/api/quotes/${this.quote.id}/revisions`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    async saveVersion() {
      this.savingVersion = true;
      try {
        await this.saveNow();
        const result = await api('POST', `/api/quotes/${this.quote.id}/revisions`, { note: this.versionNote, by: state.me });
        toast(result.skipped ? `Nothing has changed since version ${result.revision.n}` : `Saved as version ${result.revision.n}`);
        this.versionNote = '';
        await this.loadRevisions();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        this.savingVersion = false;
      }
    },
    async restoreVersion(rev) {
      if (!confirm(`Go back to version ${rev.n}? What you have now is saved as a version first, so you can undo this.`)) return;
      try {
        await this.saveNow();
        const restored = await api('POST', `/api/quotes/${this.quote.id}/revisions/${rev.n}/restore`, { by: state.me });
        this.setQuote(restored);
        this.compareN = null;
        await this.loadRevisions();
        toast(`Back to version ${rev.n}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    toggleProfit() {
      this.hideProfit = !this.hideProfit;
      storageSet('mesh.hideProfit', this.hideProfit ? '1' : '0');
    },
    async copyClientLink() {
      // Sharing the link is sending it, so mark the quote as Sent.
      const marked = ['draft', 'changes'].includes(this.quote.status);
      if (marked) {
        this.quote.status = 'sent';
        await nextTick();
      }
      await this.saveNow();
      api('POST', `/api/quotes/${this.quote.id}/revisions`, { kind: 'sent', note: 'Client link copied', by: state.me })
        .then(() => this.revisions && this.loadRevisions())
        .catch(() => {});
      if (await copyText(`${location.origin}/p/${this.quote.id}`)) {
        toast(marked ? 'Client link copied, and the quote is now marked as Sent.' : 'Client link copied. Anyone with this link can view (not edit) the proposal.');
      }
    },
    async openProposal(pdf) {
      const win = window.open('about:blank', '_blank');
      await this.saveNow();
      const url = `/p/${this.quote.id}${pdf ? '/pdf' : ''}`;
      if (win) win.location = url;
      else location.href = url;
    },
    async duplicate() {
      await this.saveNow();
      try {
        const copy = await api('POST', `/api/quotes/${this.quote.id}/duplicate`);
        location.hash = `#/quote/${copy.id}`;
        toast(`Created ${copy.number}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    async remove() {
      if (!confirm(`Delete ${this.quote.number} “${this.quote.title}”? This cannot be undone.`)) return;
      try {
        await api('DELETE', `/api/quotes/${this.quote.id}`);
        this.saveState = 'saved';
        location.hash = '#/';
        toast(`Deleted ${this.quote.number}`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },

    // Areas
    addSection() {
      const n = this.quote.sections.length + 1;
      this.quote.sections.push({ id: uid(), name: `Area ${n}`, description: '', items: [] });
      nextTick(() => {
        const inputs = this.$el.querySelectorAll('.section-name');
        inputs[inputs.length - 1]?.select();
      });
    },
    openKitDraft(section) {
      this.kitDraft = { items: section.items, name: section.name, description: section.description || '', saving: false };
    },
    async saveKit() {
      const d = this.kitDraft;
      if (!d.name.trim()) return toast('Give the kit a name', 'error');
      d.saving = true;
      try {
        const items = clone(d.items).map(({ id, ...item }) => ({ ...item, labour: (item.labour || []).map(({ id: _id, ...l }) => l) }));
        await api('POST', '/api/kits', { name: d.name, description: d.description, items });
        await loadKits(true);
        this.kitDraft = null;
        toast(`Saved kit “${d.name}”. Find it under Add product, then Kits.`);
      } catch (err) {
        d.saving = false;
        toast(err.message, 'error');
      }
    },
    removeSection(section) {
      if (section.items.length && !confirm(`Remove “${section.name}” and its ${section.items.length} line(s)?`)) return;
      this.quote.sections.splice(this.quote.sections.indexOf(section), 1);
    },
    move(list, index, dir) {
      const to = index + dir;
      if (to < 0 || to >= list.length) return;
      const [x] = list.splice(index, 1);
      list.splice(to, 0, x);
    },

    // Lines
    addItem(item) {
      const section = this.quote.sections.find((s) => s.id === this.pickerSection);
      if (section) section.items.push(item);
    },
    addLabourLine(section) {
      section.items.push({ id: uid(), kind: 'labour', type: this.quote.labourTypes[0]?.id, hours: 1, description: '' });
    },
    removeItem(section, item) {
      section.items.splice(section.items.indexOf(item), 1);
    },
    addLabour(item, typeId) {
      item.labour.push({ id: uid(), type: typeId, hours: 1 });
      this.labourOpen[item.id] = false;
    },
    removeLabour(item, entry) {
      item.labour.splice(item.labour.indexOf(entry), 1);
    },
    unusedLabour(item) {
      const used = new Set(item.labour.map((l) => l.type));
      return this.quote.labourTypes.filter((t) => !used.has(t.id));
    },
    itemTotals(item) {
      return C.itemTotals(item, this.quote);
    },
    defaultUnit(item) {
      return C.unitPrice({ ...item, priceOverride: null }, this.quote);
    },
    defaultCost(item) {
      return C.unitCost({ ...item, costPrice: null }, this.quote);
    },
    lineMargin(item) {
      const t = this.itemTotals(item);
      if (!t.equipment) return null;
      return ((t.equipment - C.unitCost(item, this.quote) * Number(item.qty || 0)) / t.equipment) * 100;
    },
    labourCost(item, entry) {
      return Math.round(Number(entry.hours || 0) * Number(item.qty || 0) * C.labourRate(this.quote, entry.type));
    },
    rateOf(typeId) {
      return C.labourRate(this.quote, typeId);
    },
    // Has this line's catalogue price changed since it was added (store
    // refresh, or a newer Crestron price list)?
    storePriceChange(item) {
      if (item.kind === 'labour' || !C.isCatalogueItem(item)) return null;
      const v = this.priceIndex[priceKey(item)];
      if (!v || v.status === 'NoPrice') return null;
      if (v.price === item.basePrice && (v.surcharge || 0) === (item.surcharge || 0)) return null;
      return v;
    },
    applyStorePrice(item) {
      const v = this.priceIndex[priceKey(item)];
      if (!v) return;
      item.basePrice = v.price;
      item.surcharge = v.surcharge || 0;
      if (v.cost != null) item.costPrice = v.cost; // e.g. a new Crestron dealer price
    },
    applyAllStorePrices() {
      const n = this.changedPrices.length;
      for (const { item } of this.changedPrices) this.applyStorePrice(item);
      toast(`Updated ${n} line${n === 1 ? '' : 's'} to current catalogue prices`);
    },
    // Ask Habitech for today's price, cost and stock of the quote's Habitech
    // lines (each SKU once per visit). A failure just leaves the lines as they are.
    async loadLivePrices() {
      this.liveAsked ||= new Set();
      const bySource = {};
      for (const key of this.liveKeys.split('\n').filter(Boolean)) {
        if (this.liveAsked.has(key)) continue;
        this.liveAsked.add(key);
        const [source, ...rest] = key.split('|');
        (bySource[source] ||= []).push(rest.join('|'));
      }
      for (const [source, skus] of Object.entries(bySource)) {
        try {
          const { prices } = await api('POST', `/api/catalogue/${source}/prices`, { skus });
          const next = { ...this.livePrices };
          for (const [sku, v] of Object.entries(prices)) if (v.status !== 'NoPrice') next[`${source}|${sku}`] = v;
          this.livePrices = next;
        } catch (err) {
          for (const sku of skus) this.liveAsked.delete(`${source}|${sku}`); // try again next time
          console.warn(`Could not check ${source} prices: ${err.message}`);
        }
      }
    },
    liveStock(item) {
      return isLiveSource(item.source) ? stockText(this.livePrices[priceKey(item)]) : '';
    },

    // Our own names for catalogue products (Our products are renamed on the
    // Products page instead).
    nameId(item) {
      return item.productId && C.isCatalogueItem(item) ? item.productId : null;
    },
    // The line's name without the option on the end, e.g. "(Black)".
    baseName(item) {
      const name = String(item.name || '').trim();
      const option = item.variantLabel ? ` (${item.variantLabel})` : '';
      return option && name.endsWith(option) ? name.slice(0, -option.length).trim() : name;
    },
    hasSavedName(item) {
      const saved = savedName(this.nameId(item));
      return Boolean(saved) && saved === this.baseName(item);
    },
    // Offered after a catalogue line is renamed.
    nameOffer(item) {
      return Boolean(this.renamed[item.id] && this.nameId(item) && this.baseName(item) && !this.hasSavedName(item));
    },
    async rememberName(item) {
      const name = this.baseName(item);
      try {
        await saveProductName(this.nameId(item), name);
        this.renamed[item.id] = false;
        const example = item.variantLabel ? `, e.g. “${name} (${item.variantLabel})”` : '';
        toast(`Saved. From now on it’s added to quotes as “${name}”${example}.`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    liveStockLevel(item) {
      return this.livePrices[priceKey(item)]?.stock || '';
    },

    // Add to Habitech basket: find each product on Habitech's website, then
    // the team ticks what to order and opens the basket link.
    async openBasket() {
      const seq = (this.basketSeq = (this.basketSeq || 0) + 1);
      const rows = this.habitechLines.map((r) => ({ ...r, order: Math.max(1, r.qty), pick: r.qty > 0, id: null, state: 'checking' }));
      this.basket = { rows, loading: true, error: null, link: '' };
      try {
        const res = await api('POST', '/api/habitech/basket', { skus: rows.map((r) => r.sku) });
        if (!this.basket || this.basketSeq !== seq) return; // closed or reopened meanwhile
        for (const r of this.basket.rows) {
          r.id = res.ids[r.sku] || null;
          r.state = r.id ? 'found' : res.missing.includes(r.sku) ? 'missing' : 'unchecked';
        }
        this.basket.link = res.link;
      } catch (err) {
        if (this.basket && this.basketSeq === seq) this.basket.error = err.message;
      } finally {
        if (this.basket && this.basketSeq === seq) this.basket.loading = false;
      }
    },
    pickAllBasket(on) {
      for (const r of this.basketRows) r.pick = on;
    },
    basketOpened(e) {
      if (!this.basketLink) {
        e.preventDefault();
        return;
      }
      toast('Opened Habitech’s website in a new tab. Check the basket there before you check out.');
      setTimeout(() => (this.basket = null), 300); // after the link has opened
    },

    // Proposal text
    addScope() {
      this.quote.scope.push({ id: uid(), heading: 'New section', body: '' });
    },
    removeScope(s) {
      if (s.body.trim() && !confirm(`Remove “${s.heading}”?`)) return;
      this.quote.scope.splice(this.quote.scope.indexOf(s), 1);
    },

    // Pricing
    useDefaultRates() {
      for (const t of this.settings.labourTypes) {
        const existing = this.quote.labourTypes.find((x) => x.id === t.id);
        if (existing) {
          existing.name = t.name;
          existing.rate = t.rate;
          existing.cost = t.cost ?? null;
        } else this.quote.labourTypes.push(clone(t));
      }
      toast('Labour rates set to the defaults from Settings');
    },
  },
  template: `
  <div class="page editor" v-if="loadError">
    <div class="card empty-state"><h2>Could not open this quote</h2><p class="muted">{{ loadError }}</p><a class="btn" href="#/">Back to quotes</a></div>
  </div>
  <div class="page editor" v-else-if="!quote"><div class="empty loading">Loading…</div></div>
  <div class="page editor" v-else>
    <div class="editor-head">
      <MeshBand />
      <a class="back" href="#/">&larr; Quotes</a>
      <div class="title-row">
        <span class="ref">{{ quote.number }}</span>
        <input class="title-input" v-model="quote.title" placeholder="Proposal title" aria-label="Proposal title">
        <select class="status-select" :class="quote.status" v-model="quote.status" aria-label="Status">
          <option v-for="(label, key) in STATUS_LABELS" :value="key">{{ label }}</option>
        </select>
      </div>
      <div class="head-actions">
        <span class="save-state" :class="saveState">{{ saveLabel }}</span>
        <button class="btn ghost" @click="duplicate">Duplicate</button>
        <button class="btn ghost danger" @click="remove">Delete</button>
        <button class="btn" @click="copyClientLink" title="A view-only link to this proposal that you can send to the client">Copy client link</button>
        <button class="btn" @click="openProposal(false)">Preview proposal</button>
        <button class="btn primary" @click="openProposal(true)">{{ pdfLabel }}</button>
      </div>
    </div>

    <div class="reply-card" :class="reply.action" v-if="reply">
      <span class="rc-mark"></span>
      <div class="rc-body">
        <div class="rc-title"><b>{{ REPLY_LABELS[reply.action] }}</b> by {{ reply.name }} · {{ formatDateTime(reply.at) }}</div>
        <div class="rc-meta" v-if="reply.po || reply.email">
          <span v-if="reply.po">PO {{ reply.po }}</span>
          <a v-if="reply.email" :href="'mailto:' + reply.email">{{ reply.email }}</a>
        </div>
        <div class="rc-message" v-if="reply.message">“{{ reply.message }}”</div>
        <div class="rc-meta" v-if="reply.action === 'accept' && reply.total !== totals.total">The total has changed since they accepted: {{ money(reply.total) }} then, {{ money(totals.total) }} now.</div>
        <div class="rc-meta" v-if="reply.action === 'changes'">Make the changes, then copy the client link again to send them the update.</div>
      </div>
    </div>

    <nav class="tabs editor-tabs" v-tab-ink>
      <button :class="{ active: tab === 'items' }" @click="tab = 'items'">Equipment &amp; labour</button>
      <button :class="{ active: tab === 'details' }" @click="tab = 'details'">Client &amp; details</button>
      <button :class="{ active: tab === 'text' }" @click="tab = 'text'">Proposal text</button>
      <button :class="{ active: tab === 'pricing' }" @click="tab = 'pricing'">Pricing &amp; terms</button>
      <button :class="{ active: tab === 'history' }" @click="tab = 'history'">History<span class="count" v-if="activity && activity.views.count">{{ activity.views.count }} view{{ activity.views.count === 1 ? '' : 's' }}</span></button>
    </nav>

    <div class="editor-body">
      <div class="editor-main">

        <!-- Equipment & labour -->
        <template v-if="tab === 'items'">
          <div class="notice" v-if="changedPrices.length">
            {{ changedPrices.length }} product price{{ changedPrices.length === 1 ? ' has' : 's have' }} changed in the catalogue since {{ changedPrices.length === 1 ? 'it was' : 'they were' }} added.
            <button class="link" @click="applyAllStorePrices">Update to current prices</button>
          </div>

          <TransitionGroup name="area">
          <section class="card area-card" v-for="(section, si) in quote.sections" :key="section.id">
            <header class="area-head">
              <span class="area-mark"></span>
              <input class="section-name" v-model="section.name" placeholder="Area or system name, e.g. Ground floor, Network rack" aria-label="Area name">
              <span class="area-sum"><AnimatedNumber :value="totals.sections[si].total" money /></span>
              <div class="mini-actions">
                <button class="icon-btn" title="Move up" @click="move(quote.sections, si, -1)" :disabled="si === 0">↑</button>
                <button class="icon-btn" title="Move down" @click="move(quote.sections, si, 1)" :disabled="si === quote.sections.length - 1">↓</button>
                <button class="icon-btn danger" title="Remove area" @click="removeSection(section)">✕</button>
              </div>
            </header>
            <AutoTextarea class="area-desc" plain v-model="section.description" :rows="1" placeholder="Describe this area for the client (optional) — what it covers and why" />

            <div class="lines" v-if="section.items.length">
              <div class="line-head">
                <span></span><span>Item</span><span class="c">Qty</span><span class="r">Unit price</span><span class="r">Total</span><span></span>
              </div>
              <TransitionGroup tag="div" name="row" class="line-list">
              <div v-for="(item, ii) in section.items" :key="item.id" class="line" :class="{ 'labour-only': item.kind === 'labour' }">
                <template v-if="item.kind === 'labour'">
                  <div class="thumb labour-thumb"><span></span></div>
                  <div class="l-main">
                    <div class="l-name-row">
                      <select v-model="item.type" class="labour-type">
                        <option v-for="t in quote.labourTypes" :value="t.id">{{ t.name }}</option>
                      </select>
                      <span class="muted sm">{{ money(rateOf(item.type)) }}/hr</span>
                    </div>
                    <input class="plain-input" v-model="item.description" placeholder="What this covers, e.g. Site survey and system design">
                  </div>
                  <label class="l-qty hours-input"><input type="number" min="0" step="0.25" v-model.number="item.hours" aria-label="Hours"><span>hrs</span></label>
                  <div class="l-unit r muted">—</div>
                  <div class="l-total r strong">{{ money(itemTotals(item).total) }}</div>
                  <div class="l-actions">
                    <button class="icon-btn" title="Move up" @click="move(section.items, ii, -1)" :disabled="ii === 0">↑</button>
                    <button class="icon-btn" title="Move down" @click="move(section.items, ii, 1)" :disabled="ii === section.items.length - 1">↓</button>
                    <button class="icon-btn danger" title="Remove" @click="removeItem(section, item)">✕</button>
                  </div>
                </template>

                <template v-else>
                  <div class="thumb"><img v-if="item.image" :src="item.image" alt=""></div>
                  <div class="l-main">
                    <input class="l-name plain-input" v-model="item.name" aria-label="Item name" @change="renamed[item.id] = true">
                    <div class="name-offer" v-if="nameOffer(item)">
                      <button class="link sm" @click="rememberName(item)">Always use this name for this product</button>
                      <button class="link sm muted" @click="renamed[item.id] = false">Just this quote</button>
                    </div>
                    <div class="l-sub">
                      <span class="src" :class="item.source">{{ item.manufacturer }}</span>
                      <span>{{ item.sku || item.model }}</span>
                      <span class="saved-name-tag" v-if="hasSavedName(item)" title="Every quote gets this name for this product. Change it on the Products page (Rename).">Saved name</span>
                      <span class="stock" v-if="liveStock(item)" :class="liveStockLevel(item)">{{ liveStock(item) }}</span>
                      <a v-if="item.url" :href="item.url" target="_blank" rel="noopener">store page ↗</a>
                      <button class="link sm" @click="descOpen[item.id] = !descOpen[item.id]">{{ descOpen[item.id] ? 'Hide description' : 'Description' }}</button>
                      <button class="link sm" v-if="!item.discount" @click="discOpen[item.id] = !discOpen[item.id]">Discount</button>
                      <button class="link sm" @click="costOpen[item.id] = !costOpen[item.id]">{{ costOpen[item.id] ? 'Hide cost' : 'Our cost' }}</button>
                    </div>
                    <AutoTextarea v-if="descOpen[item.id]" class="l-desc" v-model="item.description" :rows="2" placeholder="Description shown to the client" />
                    <div class="l-extras" v-if="discOpen[item.id] || item.discount">
                      <label class="mini-field">Discount <input type="number" min="0" max="100" step="0.5" v-model.number="item.discount" aria-label="Discount percent"> %</label>
                      <span class="muted sm" v-if="itemTotals(item).discount">saves the client {{ money(itemTotals(item).discount) }}</span>
                      <button class="link sm" @click="item.discount = 0; discOpen[item.id] = false">{{ item.discount ? 'Remove' : 'Cancel' }}</button>
                    </div>
                    <div class="l-extras internal" v-if="costOpen[item.id]">
                      <label class="mini-field">Our cost each <MoneyInput small v-model="item.costPrice" :placeholder="defaultCost(item)" /></label>
                      <span class="sm" :class="lineMargin(item) < 0 ? 'error-text' : 'muted'" v-if="lineMargin(item) !== null">{{ pct(lineMargin(item)) }} margin</span>
                      <span class="muted sm" v-if="item.costPrice == null && item.source === 'ubiquiti'">(store price{{ quote.costDiscount ? ' less ' + quote.costDiscount + '%' : '' }})</span>
                      <span class="muted sm" v-else-if="item.source === 'crestron' && item.costPrice != null">(Crestron dealer price)</span>
                      <span class="muted sm" v-else-if="item.source === 'habitech' && item.costPrice != null">(Habitech trade price)</span>
                      <span class="muted sm" v-else-if="item.costPrice == null && item.source === 'sonos' && quote.sonosCostDiscount != null && quote.sonosCostDiscount !== ''">(Sonos price less {{ quote.sonosCostDiscount }}%)</span>
                      <span class="muted sm" v-else-if="item.costPrice == null && item.source === 'sonos'">(type what we pay, or set the Sonos discount under Pricing &amp; terms)</span>
                    </div>
                    <div class="price-change" v-if="storePriceChange(item)">
                      {{ item.source === 'habitech' ? 'Habitech SRP' : 'Store price' }} now {{ money(storePriceChange(item).price) }}<template v-if="storePriceChange(item).surcharge"> + {{ money(storePriceChange(item).surcharge) }} surcharge</template><template v-if="storePriceChange(item).cost != null && storePriceChange(item).cost !== item.costPrice && item.source === 'habitech'"> (our cost {{ money(storePriceChange(item).cost) }})</template>
                      <button class="link sm" @click="applyStorePrice(item)">Update</button>
                    </div>
                  </div>
                  <label class="l-qty"><input type="number" min="0" step="1" v-model.number="item.qty" aria-label="Quantity"></label>
                  <div class="l-unit r">
                    <MoneyInput small v-model="item.priceOverride" :placeholder="defaultUnit(item)" />
                    <div class="price-note" v-if="item.priceOverride != null"><button class="link sm" @click="item.priceOverride = null">Reset to {{ money(defaultUnit(item)) }}</button></div>
                    <div class="price-note" v-else-if="item.source === 'ubiquiti' && item.surcharge && quote.includeSurcharges !== false">incl. {{ money(item.surcharge) }} surcharge</div>
                    <div class="price-note" v-else-if="item.source === 'ubiquiti' && quote.markup">store {{ money(item.basePrice + (quote.includeSurcharges !== false ? item.surcharge || 0 : 0)) }} + {{ quote.markup }}%</div>
                  </div>
                  <div class="l-total r strong"><s class="was" v-if="itemTotals(item).discount">{{ money(itemTotals(item).gross) }}</s>{{ money(itemTotals(item).equipment) }}</div>
                  <div class="l-actions">
                    <button class="icon-btn" title="Move up" @click="move(section.items, ii, -1)" :disabled="ii === 0">↑</button>
                    <button class="icon-btn" title="Move down" @click="move(section.items, ii, 1)" :disabled="ii === section.items.length - 1">↓</button>
                    <button class="icon-btn danger" title="Remove" @click="removeItem(section, item)">✕</button>
                  </div>

                  <div class="labour-row">
                    <div class="labour-chip" v-for="entry in item.labour" :key="entry.id">
                      <select v-model="entry.type" aria-label="Labour type">
                        <option v-for="t in quote.labourTypes" :value="t.id">{{ t.name }}</option>
                      </select>
                      <input type="number" min="0" step="0.25" v-model.number="entry.hours" aria-label="Hours">
                      <span class="muted">{{ item.qty > 1 ? 'hrs each' : 'hrs' }}</span>
                      <span class="muted" v-if="item.qty > 1">= {{ hours(entry.hours * item.qty) }}</span>
                      <b>{{ money(labourCost(item, entry)) }}</b>
                      <button class="icon-btn sm" title="Remove labour" @click="removeLabour(item, entry)">✕</button>
                    </div>
                    <template v-if="labourOpen[item.id]">
                      <button class="chip add" v-for="t in unusedLabour(item)" :key="t.id" @click="addLabour(item, t.id)">+ {{ t.name }}</button>
                      <button class="link sm" @click="labourOpen[item.id] = false">Cancel</button>
                    </template>
                    <button v-else-if="unusedLabour(item).length" class="link sm add-labour" @click="labourOpen[item.id] = true">+ Add labour</button>
                    <span class="labour-total" v-if="itemTotals(item).labourCost">Labour {{ money(itemTotals(item).labourCost) }}</span>
                  </div>
                </template>
              </div>
              </TransitionGroup>
            </div>
            <div class="area-empty" v-else>No items in this area yet.</div>

            <footer class="area-foot">
              <button class="btn primary" @click="pickerSection = section.id">+ Add product</button>
              <button class="btn" @click="addLabourLine(section)">+ Add labour line</button>
              <button class="btn ghost" v-if="section.items.length" @click="openKitDraft(section)" title="Save these lines to reuse on other quotes">Save as kit</button>
              <div class="area-foot-sum">
                <span>Equipment <b>{{ money(totals.sections[si].equipment) }}</b></span>
                <span>Labour <b>{{ money(totals.sections[si].labour) }}</b> <small>({{ hours(totals.sections[si].hours) }})</small></span>
              </div>
            </footer>
          </section>
          </TransitionGroup>

          <button class="btn add-area" @click="addSection">+ Add area or system</button>
        </template>

        <!-- Client & details -->
        <template v-if="tab === 'details'">
          <section class="card">
            <h2 class="card-title">Proposal</h2>
            <div class="form-grid">
              <label class="span-2">Title<input v-model="quote.title" placeholder="e.g. Whole-home WiFi upgrade"></label>
              <label>Date<input type="date" v-model="quote.date"></label>
              <label>Valid for (days)<input type="number" min="1" v-model.number="quote.validDays"><small class="muted">Until {{ validUntil }}</small></label>
              <label>Prepared by
                <input v-model="quote.preparedBy" list="team-list" placeholder="Your name">
                <datalist id="team-list"><option v-for="n in team" :value="n"></option></datalist>
              </label>
              <label>Status
                <select v-model="quote.status">
                  <option v-for="(label, key) in STATUS_LABELS" :value="key">{{ label }}</option>
                </select>
              </label>
            </div>
          </section>
          <section class="card">
            <h2 class="card-title">Client</h2>
            <div class="form-grid">
              <label>Contact name<input v-model="quote.client.name" autocomplete="off"></label>
              <label>Company (if any)<input v-model="quote.client.company" autocomplete="off"></label>
              <label>Email<input type="email" v-model="quote.client.email" autocomplete="off"></label>
              <label>Phone<input v-model="quote.client.phone" autocomplete="off"></label>
              <label class="span-2">Address<AutoTextarea v-model="quote.client.address" :rows="3" /></label>
              <label class="span-2">Site address (if different)<AutoTextarea v-model="quote.siteAddress" :rows="2" /></label>
            </div>
          </section>
        </template>

        <!-- Proposal text -->
        <template v-if="tab === 'text'">
          <p class="hint">Write in plain text. Leave a blank line for a new paragraph, start a line with “- ” for a bullet point, and wrap words in **double asterisks** for bold. Sections left empty are not shown on the proposal.</p>
          <section class="card">
            <h2 class="card-title">Introduction</h2>
            <AutoTextarea v-model="quote.intro" :rows="4" placeholder="A short opening to the client" />
          </section>
          <section class="card scope-card" v-for="(s, i) in quote.scope" :key="s.id">
            <div class="scope-head">
              <input class="scope-heading" v-model="s.heading" placeholder="Section heading" aria-label="Section heading">
              <div class="mini-actions">
                <button class="icon-btn" title="Move up" @click="move(quote.scope, i, -1)" :disabled="i === 0">↑</button>
                <button class="icon-btn" title="Move down" @click="move(quote.scope, i, 1)" :disabled="i === quote.scope.length - 1">↓</button>
                <button class="icon-btn danger" title="Remove" @click="removeScope(s)">✕</button>
              </div>
            </div>
            <AutoTextarea v-model="s.body" :rows="5" :placeholder="'Write the ' + (s.heading || 'section').toLowerCase() + ' here…'" />
          </section>
          <button class="btn add-area" @click="addScope">+ Add text section</button>
          <p class="hint">Each area on the Equipment tab also has its own description, shown above its equipment list.</p>
        </template>

        <!-- Pricing & terms -->
        <template v-if="tab === 'pricing'">
          <section class="card">
            <div class="card-title-row">
              <h2 class="card-title">Labour rates for this quote</h2>
              <button class="link" @click="useDefaultRates">Use default rates from Settings</button>
            </div>
            <table class="rates">
              <thead><tr><th>Labour type</th><th>Rate per hour (ex VAT)</th><th>Our cost per hour <small>(internal)</small></th><th class="num">Hours on quote</th><th class="num">Total</th></tr></thead>
              <tbody>
                <tr v-for="t in quote.labourTypes" :key="t.id">
                  <td><input v-model="t.name" aria-label="Labour type name"></td>
                  <td><MoneyInput v-model="t.rate" small /></td>
                  <td><MoneyInput v-model="t.cost" small placeholder="" /></td>
                  <td class="num">{{ hours((totals.labourByType.find(x => x.id === t.id) || {}).hours || 0) }}</td>
                  <td class="num strong">{{ money((totals.labourByType.find(x => x.id === t.id) || {}).cost || 0) }}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section class="card">
            <h2 class="card-title">Discount on the whole quote</h2>
            <div class="form-grid">
              <label>Discount
                <select v-model="quote.discount.type">
                  <option value="none">No discount</option>
                  <option value="percent">Percentage off</option>
                  <option value="amount">Fixed amount off</option>
                </select>
              </label>
              <label v-if="quote.discount.type === 'percent'">Percentage off (%)<input type="number" min="0" max="100" step="0.5" v-model.number="quote.discount.percent"></label>
              <label v-if="quote.discount.type === 'amount'">Amount off (ex VAT)<MoneyInput v-model="quote.discount.amount" /></label>
              <label class="span-2" v-if="quote.discount.type !== 'none'">Name shown to the client
                <input v-model="quote.discount.label" placeholder="e.g. Loyalty discount, Package saving">
                <small class="muted">The investment summary will show “{{ totals.discountLabel }}: −{{ money(totals.discount) }}”.</small>
              </label>
            </div>
            <p class="muted sm" v-if="quote.discount.type === 'none'">To discount one item instead, click <b>Discount</b> under it on the Equipment &amp; labour tab.</p>
          </section>

          <section class="card">
            <h2 class="card-title">Equipment pricing</h2>
            <div class="form-grid">
              <label>Markup on Ubiquiti store prices (%)
                <input type="number" step="0.5" v-model.number="quote.markup">
                <small class="muted">Applied to catalogue items without a price you've typed in. Use a negative number for a discount.</small>
              </label>
              <label>Our trade discount off Ubiquiti store prices (%)
                <input type="number" step="0.5" min="0" max="100" v-model.number="quote.costDiscount">
                <small class="muted">Internal only, for the profit figure. If you buy 15% below the store price, enter 15.</small>
              </label>
              <label>Our trade discount off Sonos prices (%)
                <input type="number" step="0.5" min="0" max="100" v-model.number="quote.sonosCostDiscount" placeholder="Not set">
                <small class="muted">Internal only, for the profit figure. Off the Sonos UK price (ex VAT). Leave empty to type each Sonos cost yourself.</small>
              </label>
              <label>VAT rate (%)<input type="number" step="0.5" min="0" v-model.number="quote.vatRate"></label>
              <label class="check span-2"><input type="checkbox" v-model="quote.includeSurcharges">
                <span>Include Ubiquiti surcharges in prices <small class="muted">— some products carry a surcharge (e.g. “Memory”) that the store adds at checkout on top of the listed price.</small></span>
              </label>
            </div>
            <div class="notice slim" v-if="changedPrices.length">{{ changedPrices.length }} line(s) have a newer catalogue price. <button class="link" @click="applyAllStorePrices">Update them</button></div>
          </section>

          <section class="card">
            <h2 class="card-title">What the proposal shows</h2>
            <div class="layout-choice">
              <label class="choice" :class="{ active: quote.display.layout !== 'summary' }">
                <input type="radio" value="detailed" v-model="quote.display.layout">
                <span><b>Every item</b><small>Each product with its quantity and price</small></span>
              </label>
              <label class="choice" :class="{ active: quote.display.layout === 'summary' }">
                <input type="radio" value="summary" v-model="quote.display.layout">
                <span><b>Area totals only</b><small>What's in each area, with one price per area</small></span>
              </label>
            </div>
            <div class="checks" :class="{ dim: quote.display.layout === 'summary' }">
              <label class="check"><input type="checkbox" v-model="quote.display.showImages"> Product images</label>
              <label class="check"><input type="checkbox" v-model="quote.display.showItemPrices"> Price of each item</label>
              <label class="check"><input type="checkbox" v-model="quote.display.showSku"> Manufacturer and model numbers</label>
              <label class="check"><input type="checkbox" v-model="quote.display.showLabourDetail"> Labour under each item <small class="muted">(with hours and rates)</small></label>
            </div>
            <label class="inline-select">Labour
              <select v-model="quote.display.labourPlacement">
                <option value="area">At the bottom of each area</option>
                <option value="end">In one section after the areas</option>
              </select>
            </label>
            <label class="check cover-option"><input type="checkbox" v-model="frontCover"> Front cover <small class="muted">(the house picture with client, project, date and revision; adds a page)</small></label>
          </section>

          <section class="card">
            <h2 class="card-title">Terms</h2>
            <AutoTextarea v-model="quote.terms" :rows="6" placeholder="One term per line" />
          </section>

          <section class="card">
            <h2 class="card-title">Internal notes <small class="muted">— never shown to the client</small></h2>
            <AutoTextarea v-model="quote.notes" :rows="3" placeholder="Notes for the team" />
          </section>
        </template>

        <!-- History -->
        <template v-if="tab === 'history'">
          <section class="card">
            <h2 class="card-title">Client activity</h2>
            <div v-if="!activity" class="empty loading">Loading…</div>
            <template v-else>
              <div class="activity-stats">
                <div><span>Times opened</span><b>{{ activity.views.count }}</b></div>
                <div><span>First opened</span><b>{{ activity.views.first ? formatDateTime(activity.views.first) : '—' }}</b></div>
                <div><span>Last opened</span><b>{{ activity.views.last ? timeAgo(activity.views.last) : '—' }}</b></div>
              </div>
              <ul class="timeline" v-if="timeline.length">
                <li v-for="(e, i) in timeline" :key="i" :class="e.kind">
                  <span class="t-dot"></span>
                  <div><div class="t-title">{{ e.title }}</div><div class="muted sm" v-if="e.detail">{{ e.detail }}</div></div>
                  <span class="muted sm t-time">{{ formatDateTime(e.at) }}</span>
                </li>
              </ul>
              <p class="muted sm" v-else-if="session && session.authEnabled">Nobody has opened the client link yet. When they do, you'll see it here. Your own team's views don't count.</p>
              <p class="muted sm" v-else>Views are counted on the online version, where the team signs in with a password, so your own views aren't mistaken for the client's.</p>
            </template>
          </section>

          <section class="card">
            <h2 class="card-title">Versions</h2>
            <p class="muted sm">A version is saved each time you copy the client link (if anything changed) and whenever the client replies. You can save one yourself too.</p>
            <div class="version-save">
              <input v-model="versionNote" maxlength="200" placeholder="Note (optional), e.g. Before adding the garden" @keydown.enter="saveVersion">
              <button class="btn" @click="saveVersion" :disabled="savingVersion">{{ savingVersion ? 'Saving…' : 'Save version' }}</button>
            </div>
            <div v-if="!revisions" class="empty loading">Loading…</div>
            <div v-else-if="!versions.length" class="empty">No versions saved yet.</div>
            <ul class="versions" v-else>
              <li v-for="v in versions" :key="v.n" :class="[v.kind, { open: compareN === v.n }]">
                <div class="v-row">
                  <div class="v-main">
                    <div class="v-title"><b>Version {{ v.n }}</b><span class="v-kind">{{ VERSION_KINDS[v.kind] || 'Saved' }}</span></div>
                    <div class="muted sm">{{ formatDateTime(v.at) }}<template v-if="v.by"> · {{ v.by }}</template><template v-if="v.note && (v.kind === 'manual' || v.kind === 'restore')"> · {{ v.note }}</template></div>
                  </div>
                  <div class="v-total">{{ money(v.total) }}<small>inc VAT</small></div>
                  <div class="v-actions">
                    <button class="btn sm" @click="compareN = compareN === v.n ? null : v.n">{{ compareN === v.n ? 'Hide' : 'What changed since' }}</button>
                    <button class="btn ghost sm" @click="restoreVersion(v)">Go back to this</button>
                  </div>
                </div>
                <div class="v-diff" v-if="comparison && compareN === v.n">
                  <p v-if="!comparison.changes.length" class="muted sm">Nothing has changed since this version.</p>
                  <ul v-else>
                    <li v-for="(c, i) in comparison.changes" :key="i" :class="c.type">{{ c.text }}</li>
                  </ul>
                  <div class="v-diff-total" v-if="comparison.totalBefore !== comparison.totalAfter">
                    Total {{ money(comparison.totalBefore) }} → {{ money(comparison.totalAfter) }} inc VAT
                    <b :class="comparison.totalAfter > comparison.totalBefore ? 'up' : 'down'">({{ comparison.totalAfter > comparison.totalBefore ? '+' : '−' }}{{ money(Math.abs(comparison.totalAfter - comparison.totalBefore)) }})</b>
                  </div>
                </div>
              </li>
            </ul>
          </section>
        </template>
      </div>

      <aside class="editor-side">
        <div class="card summary">
          <h3>Summary</h3>
          <div class="sum-row"><span>Equipment</span><b><AnimatedNumber :value="totals.equipment" money /></b></div>
          <div class="sum-row"><span>Labour <small>{{ hours(totals.labourHours) }}</small></span><b><AnimatedNumber :value="totals.labour" money /></b></div>
          <div class="sum-sub" v-for="l in totals.labourByType.filter(x => x.hours > 0)" :key="l.id">
            <span>{{ l.name }} · {{ hours(l.hours) }}</span><span>{{ money(l.cost) }}</span>
          </div>
          <div class="sum-row disc" v-if="totals.discount"><span>{{ totals.discountLabel }}</span><b>−{{ money(totals.discount) }}</b></div>
          <div class="sum-row sep"><span>Subtotal</span><b><AnimatedNumber :value="totals.subtotal" money /></b></div>
          <div class="sum-row"><span>VAT {{ totals.vatRate }}%</span><b><AnimatedNumber :value="totals.vat" money /></b></div>
          <div class="sum-total"><span>Total inc VAT</span><strong><AnimatedNumber :value="totals.total" money from-zero /></strong></div>
          <div class="sum-savings" v-if="totals.savings">Client saves {{ money(totals.savings) }} + VAT</div>
          <div class="side-actions">
            <button class="btn" @click="openProposal(false)">Preview</button>
            <button class="btn primary" @click="openProposal(true)">PDF</button>
            <button class="btn ghost span-2" @click="copyClientLink">Copy client link</button>
          </div>
        </div>
        <div class="card profit" v-if="!hideProfit">
          <div class="profit-head"><h3>Profit <small>only you see this</small></h3><button class="link sm" @click="toggleProfit">Hide</button></div>
          <div class="profit-big" :class="marginClass"><strong><AnimatedNumber :value="totals.profit" money from-zero /></strong><span>{{ pct(totals.margin) }} margin</span></div>
          <div class="margin-bar" :class="marginClass"><span :style="{ width: Math.max(0, Math.min(100, totals.margin)) + '%' }"></span></div>
          <div class="sum-sub"><span>On equipment</span><span>{{ money(totals.equipmentProfit) }}</span></div>
          <div class="sum-sub"><span>On labour</span><span>{{ money(totals.labourProfit) }}</span></div>
          <div class="sum-sub" v-if="totals.discount"><span>Quote discount</span><span>−{{ money(totals.discount) }}</span></div>
          <div class="sum-sub"><span>Our costs</span><span>{{ money(totals.cost) }}</span></div>
          <p class="profit-note" v-if="totals.missingLabourHours">{{ hours(totals.missingLabourHours) }} of labour has no cost per hour, so it counts as all profit. <a href="#" @click.prevent="tab = 'pricing'">Add labour costs</a></p>
          <p class="profit-note" v-if="totals.missingCost">{{ totals.missingCost }} item{{ totals.missingCost === 1 ? ' has' : 's have' }} no cost price, so {{ totals.missingCost === 1 ? 'it counts' : 'they count' }} at the selling price.</p>
        </div>
        <button v-else class="link sm show-profit" @click="toggleProfit">Show profit</button>
        <div class="card habitech-card" v-if="habitechLines.length">
          <h3>Habitech</h3>
          <p class="muted sm">{{ habitechLines.length }} product{{ habitechLines.length === 1 ? '' : 's' }} on this quote {{ habitechLines.length === 1 ? 'comes' : 'come' }} from Habitech.</p>
          <button class="btn" @click="openBasket">Add to Habitech basket</button>
        </div>
        <div class="card side-meta">
          <div><span>Client</span>{{ quote.client.company || quote.client.name || '—' }}</div>
          <div><span>Prepared by</span>{{ quote.preparedBy || '—' }}</div>
          <div><span>Valid until</span>{{ validUntil }}</div>
          <div v-if="activity"><span>Client views</span>{{ activity.views.count ? activity.views.count + ' · ' + timeAgo(activity.views.last) : quote.status === 'draft' ? '—' : 'Not opened yet' }}</div>
          <a class="link sm" href="#" @click.prevent="tab = 'details'">Edit details</a>
        </div>
      </aside>
    </div>

    <Transition name="modal"><ProductPicker v-if="pickerSection" :section-name="pickerSectionName" :quote="quote" @add="addItem" @close="pickerSection = null" /></Transition>

    <Transition name="modal"><Modal v-if="kitDraft" title="Save as kit" @close="kitDraft = null">
      <p class="muted sm" style="margin-top: 0">Saves the {{ kitDraft.items.length }} line{{ kitDraft.items.length === 1 ? '' : 's' }} in this area, with their labour, so you can add them to any quote from <b>Add product → Kits</b>. Ubiquiti prices update to the store's when you add it.</p>
      <form class="form-grid" id="kit-form" @submit.prevent="saveKit">
        <label class="span-2">Kit name<input v-model="kitDraft.name" required maxlength="120" placeholder="e.g. Standard WiFi room"></label>
        <label class="span-2">Description (optional, for your team)<textarea v-model="kitDraft.description" rows="2" maxlength="1000"></textarea></label>
      </form>
      <template #footer>
        <button class="btn" @click="kitDraft = null">Cancel</button>
        <button class="btn primary" type="submit" form="kit-form" :disabled="kitDraft.saving">{{ kitDraft.saving ? 'Saving…' : 'Save kit' }}</button>
      </template>
    </Modal></Transition>

    <Transition name="modal"><Modal v-if="basket" title="Add to Habitech basket" @close="basket = null">
      <p class="hint">Tick what to order. <b>Open Habitech basket</b> opens Habitech’s website in a new tab with these added to your basket, and you check out there as normal. Sign in to Habitech in your browser first to see our prices. Anything already in the basket stays there.</p>
      <div class="empty loading" v-if="basket.loading">Finding these on Habitech’s website…</div>
      <p class="basket-error" v-else-if="basket.error">{{ basket.error }} <button class="link" @click="openBasket">Try again</button></p>
      <template v-else>
        <div class="basket-tools" v-if="basketRows.length > 1">
          <button class="link sm" @click="pickAllBasket(true)">Tick all</button>
          <button class="link sm" @click="pickAllBasket(false)">Untick all</button>
        </div>
        <ul class="basket-list" v-if="basketRows.length">
          <li v-for="r in basketRows" :key="r.sku" :class="{ off: !r.pick }">
            <input type="checkbox" v-model="r.pick" :aria-label="'Order ' + r.item.name">
            <div class="b-main" @click="r.pick = !r.pick">
              <div class="b-name">{{ r.item.name }}</div>
              <div class="b-sub">
                <span>{{ [r.item.manufacturer, r.item.model].filter(Boolean).join(' ') }}</span>
                <span v-if="r.item.model !== r.sku">Habitech {{ r.sku }}</span>
                <span v-if="r.areas.length">{{ r.areas.join(', ') }}</span>
                <span class="stock" v-if="liveStock(r.item)" :class="liveStockLevel(r.item)">{{ liveStock(r.item) }}</span>
              </div>
            </div>
            <label class="b-qty"><span>Qty</span><input type="number" min="1" max="999" step="1" v-model.number="r.order" :disabled="!r.pick" :aria-label="'Quantity of ' + r.item.name"></label>
          </li>
        </ul>
        <p class="muted" v-else>None of this quote’s Habitech products are sold on Habitech’s website.</p>
        <div class="basket-missing" v-if="basketMissing.length">
          <h4>Not on Habitech’s website</h4>
          <p class="muted sm">Order {{ basketMissing.length === 1 ? 'this' : 'these' }} from Habitech by phone or email:</p>
          <ul>
            <li v-for="r in basketMissing" :key="r.sku">{{ r.qty }} × {{ r.item.name }} <span class="muted">{{ r.sku }}</span></li>
          </ul>
        </div>
        <p class="basket-error" v-if="basketUnchecked.length">Couldn’t check {{ basketUnchecked.length === 1 ? '1 product' : basketUnchecked.length + ' products' }} on Habitech’s website this time ({{ basketUnchecked.map(r => r.sku).join(', ') }}). <button class="link" @click="openBasket">Try again</button></p>
        <p class="hint sm basket-tip" v-if="basketRows.length">Tip: put <b>{{ quote.number }}</b> as the PO number at checkout, so the order can be matched to this quote.</p>
      </template>
      <template #footer>
        <span class="basket-count muted sm" v-if="basketPicked.length">{{ basketPicked.length }} product{{ basketPicked.length === 1 ? '' : 's' }}, {{ basketItems }} item{{ basketItems === 1 ? '' : 's' }}</span>
        <button class="btn" @click="basket = null">Cancel</button>
        <a class="btn primary" :class="{ disabled: !basketLink }" :href="basketLink || undefined" :aria-disabled="!basketLink" target="_blank" rel="noopener" @click="basketOpened">Open Habitech basket</a>
      </template>
    </Modal></Transition>

    <Transition name="modal"><Modal v-if="conflict" :title="conflictByClient ? 'The client has replied' : 'This quote was changed by someone else'" @close="useTheirs">
      <p v-if="conflictByClient">While you were editing, {{ conflict.clientResponse.name }} replied on the client link: <b>{{ REPLY_LABELS[conflict.clientResponse.action] }}</b> ({{ formatDateTime(conflict.clientResponse.at) }}).</p>
      <p v-else>While you were editing, another person saved changes to {{ quote.number }} ({{ formatDateTime(conflict.updatedAt) }}).</p>
      <p class="muted">Load the latest version (your unsaved edits will be lost), or keep yours{{ conflictByClient ? ' (the client’s reply is kept either way)' : ' and replace theirs' }}.</p>
      <template #footer>
        <button class="btn" @click="keepMine">Keep mine</button>
        <button class="btn primary" @click="useTheirs">Load their version</button>
      </template>
    </Modal></Transition>
  </div>`,
};

// ---- Products page ----------------------------------------------------------------

const ProductsPage = {
  components: { MoneyInput, Modal },
  mixins: [liveSearchMixin, productListMixin],
  data() {
    return { tab: 'ubiquiti', q: '', category: '', limit: 60, editing: null, kitEditing: null, naming: null };
  },
  computed: {
    cat() {
      return state.catalogue;
    },
    catalogues: () => catalogueSources(),
    // The catalogue on the current tab (Ubiquiti, Sonos, Crestron), if any.
    source() {
      return this.catalogues.find((s) => s.id === this.tab) || null;
    },
    busy() {
      return this.cat.syncing === this.tab || this.cat.importing === this.tab || Boolean(this.source && this.source.syncing);
    },
    pool() {
      if (this.isLiveTab) return this.copy?.products || [];
      return this.cat.products.filter((p) => p.source === this.tab);
    },
    categories() {
      return [...new Set(this.pool.map((p) => p[this.filterKey]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    },
    matches() {
      return searchProducts(this.pool, this.q, this.category, this.filterKey, toRaw(productNames.map));
    },
    rows() {
      return this.isLive ? this.shown : this.shown.slice(0, this.limit);
    },
    // A copy of a live catalogue being made (or refreshed) right now.
    copyJob() {
      return this.isLiveTab ? this.liveInfo?.job || null : null;
    },
    kits: () => state.kits.list,
    kitsLoaded: () => state.kits.loaded,
    // Price kits with the default rates from Settings.
    kitQuote: () => ({ labourTypes: state.settings.labourTypes, markup: state.settings.markup, includeSurcharges: state.settings.includeSurcharges }),
  },
  watch: {
    tab() {
      this.category = '';
      this.limit = 60;
    },
    'view.sort'() {
      this.limit = 60;
    },
  },
  mounted() {
    loadCatalogue();
    loadKits();
    loadProductNames();
    for (const s of catalogueSources()) if (s.kind === 'live') loadLiveStatus(s.id);
  },
  methods: {
    ...sharedMethods,
    formatDay,
    sortPrice: lowestPrice,
    // Our own name for a product on quotes.
    rename(p) {
      const option = p.variants.length > 1 ? p.variants.map((v) => cleanVariantLabel(v.label)).find(Boolean) || '' : '';
      this.naming = { id: p.id, original: p.name, manufacturer: p.manufacturer, model: p.model, option, saved: savedName(p.id), name: savedName(p.id), busy: false };
      nextTick(() => this.$refs.nameInput?.focus());
    },
    async saveName(clear = false) {
      const n = this.naming;
      const name = clear ? '' : n.name.trim();
      n.busy = true;
      try {
        await saveProductName(n.id, name === n.original ? '' : name);
        this.naming = null;
        toast(name && name !== n.original ? `“${n.original}” is now added to quotes as “${name}”` : `“${n.original}” is added with ${n.manufacturer}’s name again`);
      } catch (err) {
        n.busy = false;
        toast(err.message, 'error');
      }
    },
    sync() {
      syncCatalogue(this.tab);
    },
    copyList() {
      copyLiveCatalogue(this.tab);
    },
    chooseImport() {
      this.$refs.importFile.value = '';
      this.$refs.importFile.click();
    },
    onImportFile(e) {
      importCatalogue(this.tab, e.target.files && e.target.files[0]);
    },
    // Our trade discount off Ubiquiti or Sonos prices, kept in Settings.
    discountField: (id) => ({ ubiquiti: 'costDiscount', sonos: 'sonosCostDiscount' })[id] || null,
    discountValue(id) {
      const v = state.settings?.[this.discountField(id)];
      return v === null || v === undefined || v === '' ? '' : v;
    },
    async saveDiscount(id, raw) {
      const field = this.discountField(id);
      const text = String(raw ?? '').trim();
      const n = Number(text);
      if (text !== '' && !Number.isFinite(n)) return toast('Enter a percentage, e.g. 15', 'error');
      const value = text === '' ? (id === 'ubiquiti' ? 0 : null) : Math.min(100, Math.max(0, n));
      const label = id === 'sonos' ? 'Sonos' : 'Ubiquiti';
      try {
        state.settings = await api('PUT', '/api/settings', { [field]: value });
        toast(value === null ? `${label} trade discount cleared` : `${label} trade discount saved: ${value}%`);
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    countOf(id) {
      if (isLiveSource(id)) return liveCopies[id]?.products?.length ?? liveStatus[id]?.copy?.count ?? liveStatus[id]?.count ?? null;
      return this.cat.loaded ? this.cat.products.filter((p) => p.source === id).length : null;
    },
    kitTotal(kit) {
      const prices = storePriceIndex();
      return kit.items.reduce((sum, i) => sum + C.itemTotals(withCurrentPrice(i, prices), this.kitQuote).total, 0);
    },
    kitLines(kit) {
      return kit.items.map((i) => (i.kind === 'labour' ? `${hours(i.hours)} ${C.labourName(this.kitQuote, i.type)}` : `${i.qty} × ${i.name}`));
    },
    editKit(k) {
      this.kitEditing = { id: k.id, name: k.name, description: k.description || '' };
    },
    async saveKitEdit() {
      const e = this.kitEditing;
      try {
        await api('PUT', `/api/kits/${encodeURIComponent(e.id)}`, { name: e.name, description: e.description });
        await loadKits(true);
        this.kitEditing = null;
        toast('Kit saved');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    async removeKit(k) {
      if (!confirm(`Delete the kit “${k.name}”? Quotes that already use it keep their items.`)) return;
      try {
        await api('DELETE', `/api/kits/${encodeURIComponent(k.id)}`);
        await loadKits(true);
        toast('Kit deleted');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    statusBadge: (s) => STATUS_BADGE[s],
    newProduct() {
      this.editing = { id: null, manufacturer: '', name: '', model: '', description: '', category: '', price: null, cost: null, image: '', url: '' };
    },
    edit(p) {
      this.editing = { id: p.id, manufacturer: p.manufacturer, name: p.name, model: p.model, description: p.description, category: p.category, price: p.price, cost: p.cost, image: p.image || '', url: p.url || '' };
    },
    async save() {
      const e = this.editing;
      if (!e.name.trim()) return toast('Give the product a name', 'error');
      try {
        if (e.id) await api('PUT', `/api/products/custom/${encodeURIComponent(e.id)}`, e);
        else await api('POST', '/api/products/custom', e);
        this.editing = null;
        await loadCatalogue(true);
        toast('Product saved');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    async remove(p) {
      if (!confirm(`Delete “${p.name}” from Our products? Existing quotes keep their copy.`)) return;
      try {
        await api('DELETE', `/api/products/custom/${encodeURIComponent(p.id)}`);
        await loadCatalogue(true);
        toast('Product deleted');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  },
  template: `
  <div class="page">
    <div class="page-head">
      <MeshBand />
      <div><p class="eyebrow">Catalogue</p><h1>Products</h1><p class="muted">The catalogue the quote builder draws from.</p></div>
      <button v-if="tab === 'custom'" class="btn primary lg" @click="newProduct">+ Add product</button>
    </div>

    <nav class="tabs" v-tab-ink>
      <button v-for="s in catalogues" :key="s.id" :class="{ active: tab === s.id }" @click="tab = s.id">{{ s.tabName }} <span class="count" v-if="countOf(s.id) != null">{{ countOf(s.id).toLocaleString('en-GB') }}</span></button>
      <button :class="{ active: tab === 'custom' }" @click="tab = 'custom'">Our products <span class="count">{{ cat.products.filter(p => p.source === 'custom').length }}</span></button>
      <button :class="{ active: tab === 'kits' }" @click="tab = 'kits'">Kits <span class="count" v-if="kitsLoaded">{{ kits.length }}</span></button>
    </nav>

    <template v-if="tab === 'kits'">
      <p class="hint">Kits are groups of items and labour you use often, such as a standard WiFi room. To make one, build an area on a quote and click <b>Save as kit</b> under it. To use one, click <b>+ Add product</b> on a quote and open <b>Kits</b>.</p>
      <div class="card" v-if="!kitsLoaded"><div class="empty loading">Loading…</div></div>
      <div class="card empty-state" v-else-if="!kits.length">
        <div class="es-mark"></div>
        <h2>No kits yet</h2>
        <p class="muted">Save an area of a quote as a kit and it will appear here, ready to add to other quotes in one click.</p>
      </div>
      <div class="kit-list" v-else>
        <section class="card kit-card" v-for="k in kits" :key="k.id">
          <div class="kit-head">
            <div class="thumb kit-thumb"><span></span><span></span><span></span></div>
            <div class="kit-title">
              <div class="strong">{{ k.name }}</div>
              <div class="muted sm">{{ k.items.length }} line{{ k.items.length === 1 ? '' : 's' }} · about {{ money(kitTotal(k)) }} ex VAT at default rates</div>
            </div>
            <div class="kit-actions">
              <button class="btn ghost sm" @click="editKit(k)">Rename</button>
              <button class="btn ghost sm danger" @click="removeKit(k)">Delete</button>
            </div>
          </div>
          <p class="muted sm kit-desc" v-if="k.description">{{ k.description }}</p>
          <ul class="kit-lines"><li v-for="(l, i) in kitLines(k)" :key="i">{{ l }}</li></ul>
        </section>
      </div>
    </template>

    <!-- Read from the maker's website (Ubiquiti, Sonos) -->
    <div class="card source-card" v-if="source && source.kind === 'web'">
      <div>
        <div class="strong">{{ (source.count || 0).toLocaleString('en-GB') }} products from <a :href="source.sourceUrl || '#'" target="_blank" rel="noopener">{{ source.site || source.tabName }}</a></div>
        <div class="muted sm" v-if="busy">Updating from the {{ source.label }} website{{ source.id === 'ubiquiti' ? ' — this takes about 10 seconds' : '' }}…</div>
        <div class="muted sm" v-else-if="source.fetchedAt">
          Prices last updated {{ formatDateTime(source.fetchedAt) }} ({{ timeAgo(source.fetchedAt) }}). Refreshes automatically once a day. Prices exclude VAT<template v-if="source.id === 'sonos'"> (worked out from the shop’s prices, which include it)</template>.
          <template v-if="source.id === 'sonos' && discountValue('sonos') === ''"> The shop doesn’t show what we pay, so set our trade discount below (or type our cost on each quote line) for the profit figure.</template>
        </div>
        <div class="error-text sm" v-if="source.error">Last refresh had a problem: {{ source.error }}</div>
        <div class="trade-discount" v-if="discountField(source.id)">
          <label>Our trade discount
            <span class="pct-input"><input type="number" min="0" max="100" step="0.5" :value="discountValue(source.id)" :placeholder="source.id === 'sonos' ? 'Not set' : '0'" @change="saveDiscount(source.id, $event.target.value)" :aria-label="'Our trade discount off ' + source.label + ' prices, percent'"><span>% off {{ source.id === 'sonos' ? 'Sonos UK prices' : 'store prices' }}</span></span>
          </label>
          <span class="muted sm trade-discount-note">Works out our cost for the profit figure (only your team sees it). New quotes use it; each quote can change it under <b>Pricing &amp; terms</b>.</span>
        </div>
      </div>
      <button class="btn" @click="sync" :disabled="Boolean(cat.syncing) || busy">{{ busy ? 'Updating…' : 'Refresh prices now' }}</button>
    </div>

    <!-- From a price list file (Crestron) -->
    <div class="card source-card" v-if="source && source.kind === 'import'">
      <div>
        <template v-if="source.count">
          <div class="strong">{{ source.count.toLocaleString('en-GB') }} products from the {{ source.label }} dealer price list<template v-if="source.priceListDate"> dated {{ formatDay(source.priceListDate) }}</template></div>
          <div class="muted sm">
            Imported {{ formatDateTime(source.fetchedAt) }}<template v-if="source.fileName"> from {{ source.fileName }}</template>.
            Selling price is the MSRP and our cost is the dealer price, both ex VAT. <span v-if="source.skipped">{{ source.skipped }} product{{ source.skipped === 1 ? '' : 's' }} marked “Contact for pricing” left out.</span>
          </div>
        </template>
        <template v-else>
          <div class="strong">No {{ source.label }} price list yet</div>
          <div class="muted sm">Download the dealer price list (Excel, GBP) from {{ source.label }}’s website and import it here. We read the “Alpha Listing” tab: the MSRP is the selling price and the dealer price is our cost.</div>
        </template>
        <div class="muted sm" v-if="source.count">To update, import the newest list: it replaces this one. Quotes keep their prices and show which lines have a new price.</div>
      </div>
      <button class="btn" :class="{ primary: !source.count }" @click="chooseImport" :disabled="busy">{{ cat.importing === source.id ? 'Importing…' : 'Import price list (.xlsx)' }}</button>
      <input type="file" ref="importFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" @change="onImportFile" hidden>
    </div>

    <!-- Searched live through the supplier's API (Habitech) -->
    <div class="card source-card" v-if="source && source.kind === 'live'">
      <div>
        <template v-if="source.configured === false || (liveInfo && liveInfo.configured === false)">
          <div class="strong">{{ source.label }} isn’t connected yet</div>
          <div class="muted sm">Add the API key from {{ source.label }} as <b>HABITECH_API_KEY</b> in Vercel → Settings → Environment Variables (tick <b>Sensitive</b>), then redeploy. On your own computer, it goes in the <b>.env</b> file in the app’s folder.</div>
        </template>
        <template v-else>
          <div class="strong">
            <template v-if="hasCopy">{{ pool.length.toLocaleString('en-GB') }} products from our {{ source.label }} trade account</template>
            <template v-else-if="liveInfo && liveInfo.count">{{ liveInfo.count.toLocaleString('en-GB') }} products in our {{ source.label }} trade account</template>
            <template v-else>Our {{ source.label }} trade account</template>
          </div>
          <div class="muted sm" v-if="copyJob">
            Copying the full list from {{ source.label }}: {{ copyJob.categoriesDone }} of {{ copyJob.categoriesTotal }} categories, {{ copyJob.products.toLocaleString('en-GB') }} products so far.
            <template v-if="busy">This takes about 3 minutes; keep this page open.</template>
            <template v-else>It carries on overnight, or click Carry on copying.</template>
          </div>
          <div class="muted sm" v-else-if="hasCopy">
            Updated {{ formatDateTime(copy.refreshedAt || copy.fetchedAt) }} ({{ timeAgo(copy.refreshedAt || copy.fetchedAt) }}); refreshes every night. The price is {{ source.label }}’s SRP and our cost is our trade price, both ex VAT.
            Today’s price is checked when you add a product, and quotes check their {{ source.label }} lines each time you open them.
          </div>
          <div class="muted sm" v-else>
            Search {{ source.label }} live below, or copy the full list (about 3 minutes) to browse everything here and in the product picker. After that it refreshes every night.
          </div>
          <div class="error-text sm" v-if="liveInfo && liveInfo.error">{{ liveInfo.error }}</div>
        </template>
      </div>
      <button v-if="source.configured !== false && !(liveInfo && liveInfo.configured === false)" class="btn" :class="{ primary: !hasCopy && !copyJob }" @click="copyList" :disabled="Boolean(cat.syncing)">
        {{ busy ? (hasCopy && !copyJob ? 'Refreshing…' : 'Copying…') : copyJob ? 'Carry on copying' : hasCopy ? 'Refresh now' : 'Copy full list' }}
      </button>
    </div>

    <template v-if="tab !== 'kits'">
    <div class="toolbar-row">
      <input class="search" type="search" v-model="q" :placeholder="isLiveTab ? 'Search ' + source.label + ' by name, brand or part code' : 'Search by name, model or SKU'">
      <select v-if="!isLiveTab || hasCopy" v-model="category"><option value="">{{ filterLabel }}</option><option v-for="c in categories" :value="c">{{ c }}</option></select>
      <span class="muted sm" v-if="!isLive">{{ shown.length.toLocaleString('en-GB') }} product{{ shown.length === 1 ? '' : 's' }}<template v-if="hiddenCount"> ({{ hiddenCount.toLocaleString('en-GB') }} hidden)</template></span>
      <span class="muted sm" v-else-if="live.products.length">{{ live.total.toLocaleString('en-GB') }} match{{ live.total === 1 ? '' : 'es' }}{{ hasCopy ? ', straight from ' + source.label : '' }}</span>
    </div>
    <div class="list-tools page-tools">
      <label class="sort-by">Sort
        <select :value="view.sort" @change="setView('sort', $event.target.value)" aria-label="Sort products">
          <option v-for="(label, key) in SORTS" :value="key">{{ label }}</option>
        </select>
      </label>
      <button v-if="gradedCount || view.hideGraded" type="button" class="chip toggle" :class="{ active: view.hideGraded }" :aria-pressed="view.hideGraded" @click="setView('hideGraded', !view.hideGraded)" title="Graded, ex-display and refurbished stock">Hide graded stock <span>{{ gradedCount.toLocaleString('en-GB') }}</span></button>
      <button v-if="outOfStockCount || view.hideOutOfStock" type="button" class="chip toggle" :class="{ active: view.hideOutOfStock }" :aria-pressed="view.hideOutOfStock" @click="setView('hideOutOfStock', !view.hideOutOfStock)">Hide out of stock <span>{{ outOfStockCount.toLocaleString('en-GB') }}</span></button>
      <span class="sort-note" v-if="isLive && live.hasMore && view.sort !== 'match'">Sorts the {{ live.products.length }} shown so far</span>
    </div>

    <div class="card table-card" :class="{ refreshing: isLive && live.loading && live.products.length }">
      <div class="empty loading" v-if="copyLoading">Loading {{ source.label }} products…</div>
      <template v-else-if="isLive">
        <div class="empty" v-if="source.configured === false">Connect {{ source.label }} (see above) to search its products here.</div>
        <div class="empty error-text" v-else-if="live.error">{{ live.error }}</div>
        <div class="empty loading" v-else-if="live.loading && !live.products.length">Searching {{ source.label }}…</div>
        <div class="empty" v-else-if="!live.products.length">{{ q.trim().length < 2 ? 'Type a product name, brand or part code to search ' + source.label + '.' : 'Nothing at ' + source.label + ' matches “' + q + '”.' }}</div>
        <div class="empty" v-else-if="!rows.length">{{ hiddenNote }} <button class="link" @click="showHidden">Show {{ hiddenCount === 1 ? 'it' : 'them' }}</button></div>
      </template>
      <div class="empty loading" v-else-if="cat.loading && !cat.loaded && !isLiveTab">Loading…</div>
      <div class="empty" v-else-if="!shown.length">
        <template v-if="tab === 'custom' && !pool.length">No products yet. Add products from other manufacturers here so you can reuse them on quotes.</template>
        <template v-else-if="source && source.kind === 'import' && !pool.length">Import the price list above to see the products here.</template>
        <template v-else-if="source && !pool.length">No products yet — click Refresh prices now.</template>
        <template v-else-if="hiddenCount">{{ hiddenNote }} <button class="link" @click="showHidden">Show {{ hiddenCount === 1 ? 'it' : 'them' }}</button></template>
        <template v-else>No products match.</template>
      </div>
      <table class="list products" v-if="rows.length">
        <thead><tr><th></th><th>Product</th><th>{{ tab === 'crestron' ? 'Range' : 'Category' }}</th><th class="num">Price ex VAT</th><th></th></tr></thead>
        <tbody>
          <tr v-for="p in rows" :key="p.id">
            <td class="thumb-cell"><div class="thumb"><img v-if="p.image" :src="p.image" alt="" loading="lazy"></div></td>
            <td>
              <div class="strong">{{ p.name }}</div>
              <div class="saved-as" v-if="savedName(p.id)">On quotes as “{{ savedName(p.id) }}”</div>
              <div class="muted sm">{{ p.manufacturer }} · {{ isLiveTab ? p.defaultSku : p.model }}<span v-if="isLiveTab && p.model !== p.defaultSku"> · part {{ p.model }}</span><span v-if="p.variants.length > 1"> · {{ p.variants.length }} options</span><span v-if="p.hasOptions"> · sold in options</span></div>
              <div class="stock sm" v-if="stockText(p.variants[0])" :class="p.variants[0].stock">{{ stockText(p.variants[0]) }}</div>
            </td>
            <td class="muted">{{ p.category }}<span v-if="p.subCategory"> / {{ p.subCategory }}</span></td>
            <td class="num">
              <template v-if="p.status !== 'NoPrice'">
                <span class="strong">{{ p.variants.length > 1 ? 'from ' : '' }}{{ money(Math.min(...p.variants.map(v => v.price))) }}</span>
                <div class="muted sm" v-if="p.variants[0].surcharge">+ surcharge</div>
                <div class="muted sm" v-if="p.cost != null && p.source !== 'custom'">our cost {{ money(p.cost) }}</div>
              </template>
              <span class="badge warn" v-if="statusBadge(p.status)">{{ statusBadge(p.status) }}</span>
            </td>
            <td class="actions">
              <a v-if="p.url" class="btn ghost sm" :href="p.url" target="_blank" rel="noopener">Store ↗</a>
              <button v-if="p.source !== 'custom'" class="btn ghost sm" @click="rename(p)" title="Choose the name this product gets on quotes">Rename</button>
              <template v-if="p.source === 'custom'">
                <button class="btn ghost sm" @click="edit(p)">Edit</button>
                <button class="btn ghost sm danger" @click="remove(p)">Delete</button>
              </template>
            </td>
          </tr>
          <tr v-if="!isLive && shown.length > limit"><td colspan="5" class="more"><button class="btn ghost" @click="limit += 60">Show more</button></td></tr>
          <tr v-if="isLive && live.hasMore"><td colspan="5" class="more"><button class="btn ghost" @click="runLiveSearch(true)" :disabled="live.loading">{{ live.loading ? 'Loading…' : 'Show more' }}</button></td></tr>
        </tbody>
      </table>
    </div>
    </template>

    <Transition name="modal"><Modal v-if="kitEditing" title="Rename kit" @close="kitEditing = null">
      <form class="form-grid" id="kit-edit-form" @submit.prevent="saveKitEdit">
        <label class="span-2">Kit name<input v-model="kitEditing.name" required maxlength="120"></label>
        <label class="span-2">Description (optional)<textarea v-model="kitEditing.description" rows="3" maxlength="1000"></textarea></label>
      </form>
      <template #footer>
        <button class="btn" @click="kitEditing = null">Cancel</button>
        <button class="btn primary" type="submit" form="kit-edit-form">Save</button>
      </template>
    </Modal></Transition>

    <Transition name="modal"><Modal v-if="naming" title="Name on quotes" @close="naming = null">
      <form class="form-grid" id="name-form" @submit.prevent="saveName(false)">
        <p class="hint span-2">“{{ naming.original }}” is {{ naming.manufacturer }}’s name for it. Choose the name your clients see instead: it’s used every time this product is added to a quote<template v-if="naming.option">, with the option after it, e.g. “{{ naming.name.trim() || naming.original }} ({{ naming.option }})”</template>. Quotes that already have it keep their name.</p>
        <label class="span-2">Name on quotes<input ref="nameInput" v-model="naming.name" :placeholder="naming.original" maxlength="300"></label>
      </form>
      <template #footer>
        <button class="btn ghost" v-if="naming.saved" @click="saveName(true)" :disabled="naming.busy">Use {{ naming.manufacturer }}’s name</button>
        <button class="btn" @click="naming = null">Cancel</button>
        <button class="btn primary" type="submit" form="name-form" :disabled="naming.busy">Save</button>
      </template>
    </Modal></Transition>

    <Transition name="modal"><Modal v-if="editing" :title="editing.id ? 'Edit product' : 'Add product'" @close="editing = null">
      <form class="form-grid" @submit.prevent="save" id="product-form">
        <label>Manufacturer<input v-model="editing.manufacturer" placeholder="e.g. Sonos"></label>
        <label>Model / SKU<input v-model="editing.model"></label>
        <label class="span-2">Product name<input v-model="editing.name" required></label>
        <label class="span-2">Description (shown to the client)<textarea v-model="editing.description" rows="3"></textarea></label>
        <label>Category<input v-model="editing.category" placeholder="e.g. Audio, Lighting, Cabling"></label>
        <label>Unit price (ex VAT)<MoneyInput v-model="editing.price" /></label>
        <label>Our cost (optional, internal)<MoneyInput v-model="editing.cost" /></label>
        <label>Product page link (optional)<input v-model="editing.url" placeholder="https://…"></label>
        <label class="span-2">Image URL (optional)<input v-model="editing.image" placeholder="https://…"></label>
      </form>
      <template #footer>
        <button class="btn" @click="editing = null">Cancel</button>
        <button class="btn primary" type="submit" form="product-form">Save product</button>
      </template>
    </Modal></Transition>
  </div>`,
};

// ---- Settings page --------------------------------------------------------------

const SettingsPage = {
  components: { MoneyInput, AutoTextarea, Modal },
  data() {
    return { s: clone(state.settings), saving: false, dirty: false, restart: null };
  },
  watch: {
    s: {
      deep: true,
      handler() {
        if (this.ready) this.dirty = true;
      },
    },
  },
  mounted() {
    nextTick(() => (this.ready = true));
  },
  computed: {
    session: () => state.session,
    install: () => installApp,
    installHelp: () => installHelpText(),
    installPlace: () => INSTALL_PLACE,
    inWindowsApp: () => IN_WINDOWS_APP,
    offerExe: () => IS_WINDOWS && !installApp.installed,
  },
  methods: {
    signOut,
    async installNow() {
      const offer = installApp.prompt;
      if (!offer) return;
      installApp.prompt = null; // each offer can only be used once
      offer.prompt();
      const { outcome } = await offer.userChoice;
      if (outcome === 'accepted') toast('Installed. Mesh Quotes now opens in its own window.');
    },
    isCore: (id) => CORE_LABOUR.includes(id),
    addMember() {
      this.s.team.push({ name: '', role: '', email: '', phone: '' });
    },
    addLabourType() {
      this.s.labourTypes.push({ id: `labour_${uid()}`, name: 'New labour type', rate: 5000, cost: null });
    },
    addScope() {
      this.s.defaultScope.push({ heading: 'New section', body: '' });
    },
    quoteNumber(n) {
      return `${this.s.quotePrefix || ''}${String(n).padStart(4, '0')}`;
    },
    async openRestart() {
      this.restart = { count: null, range: '', deleteQuotes: false, confirm: '', busy: false };
      try {
        const list = await api('GET', '/api/quotes');
        const numbers = list.map((q) => q.number).sort();
        if (!this.restart) return;
        this.restart.count = list.length;
        this.restart.range = numbers.length > 1 ? `${numbers[0]} to ${numbers[numbers.length - 1]}` : numbers[0] || '';
      } catch (err) {
        this.restart = null;
        toast(err.message, 'error');
      }
    },
    async doRestart() {
      const r = this.restart;
      r.busy = true;
      try {
        const result = await api('POST', '/api/settings/restart-numbering', { deleteQuotes: r.deleteQuotes, confirm: r.confirm.trim().toUpperCase() });
        // Show the new number without marking the settings as changed.
        const wasDirty = this.dirty;
        this.s.nextQuoteNumber = result.nextQuoteNumber;
        state.settings.nextQuoteNumber = result.nextQuoteNumber;
        nextTick(() => (this.dirty = wasDirty));
        this.restart = null;
        toast(`Quote numbers start again from ${this.quoteNumber(result.nextQuoteNumber)}${result.deleted ? ` (${result.deleted} quote${result.deleted === 1 ? '' : 's'} deleted)` : ''}`);
      } catch (err) {
        r.busy = false;
        toast(err.message, 'error');
      }
    },
    async save() {
      this.saving = true;
      try {
        this.s.team = this.s.team.filter((m) => m.name.trim());
        const saved = await api('PUT', '/api/settings', this.s);
        state.settings = saved;
        this.s = clone(saved);
        nextTick(() => (this.dirty = false));
        toast('Settings saved');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        this.saving = false;
      }
    },
  },
  template: `
  <div class="page settings">
    <div class="page-head">
      <MeshBand />
      <div><p class="eyebrow">Your business</p><h1>Settings</h1><p class="muted">Defaults for new quotes. Existing quotes keep their own copies of rates and text.</p></div>
      <button class="btn primary lg" @click="save" :disabled="saving">{{ saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved' }}</button>
    </div>

    <section class="card account-card" v-if="session && session.authEnabled">
      <div><div class="strong">Signed in</div><div class="muted sm">You stay signed in on this device for 30 days.</div></div>
      <button class="btn" @click="signOut">Sign out</button>
    </section>

    <section class="card account-card">
      <div>
        <div class="strong">Use it like a program</div>
        <div class="muted sm" v-if="inWindowsApp">You’re using the Mesh Quotes program for Windows. It shows the live website, so it’s always up to date and the quotes are the same everywhere.</div>
        <div class="muted sm" v-else-if="install.installed">You’re using Mesh Quotes as an app on this device. It updates itself, and the quotes are the same as on the website.</div>
        <div class="muted sm" v-else-if="install.prompt">Open Mesh Quotes from {{ installPlace }} in its own window, like a program. The quotes are the same as on the website, and it updates itself.</div>
        <div class="muted sm" v-else>Mesh Quotes can open from {{ installPlace }} in its own window, like a program, with the same quotes as the website. {{ installHelp }}</div>
        <div class="muted sm exe-download" v-if="offerExe">
          Or <a href="/download/MeshQuotes.exe" download>download the Windows program</a> (MeshQuotes.exe, 1 MB). Save it anywhere and double-click it; there’s nothing to install.
          Windows may warn that it isn’t commonly downloaded or is from an unknown publisher: choose <b>Keep</b>, then <b>More info → Run anyway</b>.
        </div>
      </div>
      <button class="btn primary" v-if="!install.installed && install.prompt" @click="installNow">Install app</button>
    </section>

    <section class="card">
      <h2 class="card-title">Your team</h2>
      <p class="muted sm">People who prepare quotes. Their details appear on proposals they prepare.</p>
      <div class="team-row" v-for="(m, i) in s.team" :key="i">
        <input v-model="m.name" placeholder="Name" aria-label="Name">
        <input v-model="m.role" placeholder="Role (optional)" aria-label="Role">
        <input v-model="m.email" placeholder="Email" aria-label="Email">
        <input v-model="m.phone" placeholder="Phone" aria-label="Phone">
        <button class="icon-btn danger" title="Remove" @click="s.team.splice(i, 1)">✕</button>
      </div>
      <button class="btn" @click="addMember">+ Add person</button>
    </section>

    <section class="card">
      <h2 class="card-title">Labour types and default hourly rates</h2>
      <p class="muted sm">Rates exclude VAT. New quotes start with these; each quote can change its own rates. “It costs us” is internal (for example an engineer's hourly cost) and is only used for the profit figure.</p>
      <div class="rate-row rate-head"><span>Labour type</span><span>We charge per hour</span><span>It costs us per hour</span><span class="icon-btn-spacer"></span></div>
      <div class="rate-row" v-for="(t, i) in s.labourTypes" :key="t.id">
        <input v-model="t.name" aria-label="Labour type name">
        <div class="rate-cell"><span class="rate-cell-label">We charge / hr</span><MoneyInput v-model="t.rate" /></div>
        <div class="rate-cell"><span class="rate-cell-label">Costs us / hr</span><MoneyInput v-model="t.cost" placeholder="" /></div>
        <button v-if="!isCore(t.id)" class="icon-btn danger" title="Remove" @click="s.labourTypes.splice(i, 1)">✕</button>
        <span v-else class="icon-btn-spacer"></span>
      </div>
      <button class="btn" @click="addLabourType">+ Add labour type</button>
    </section>

    <section class="card">
      <h2 class="card-title">Company details (shown on proposals)</h2>
      <div class="form-grid">
        <label>Company name<input v-model="s.company.name"></label>
        <label>Tagline<input v-model="s.company.tagline"></label>
        <label class="span-2">Address<AutoTextarea v-model="s.company.address" :rows="3" /></label>
        <label>Phone<input v-model="s.company.phone"></label>
        <label>Email<input v-model="s.company.email"></label>
        <label>Website<input v-model="s.company.website"></label>
        <label>Company number<input v-model="s.company.companyNumber"></label>
        <label>VAT number<input v-model="s.company.vatNumber"></label>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">Quote defaults</h2>
      <div class="form-grid">
        <label>Quote number prefix<input v-model="s.quotePrefix"><small class="muted">Next quote: {{ quoteNumber(s.nextQuoteNumber) }} <button type="button" class="link sm" v-if="s.nextQuoteNumber > 1" @click="openRestart">Start again from {{ quoteNumber(1) }}</button></small></label>
        <label>Valid for (days)<input type="number" min="1" v-model.number="s.validDays"></label>
        <label>VAT rate (%)<input type="number" min="0" step="0.5" v-model.number="s.vatRate"></label>
        <label>Markup on Ubiquiti store prices (%)<input type="number" step="0.5" v-model.number="s.markup"></label>
        <label>Our trade discount off Ubiquiti store prices (%)<input type="number" step="0.5" min="0" max="100" v-model.number="s.costDiscount"><small class="muted">Internal, for the profit figure</small></label>
        <label>Our trade discount off Sonos prices (%)<input type="number" step="0.5" min="0" max="100" v-model.number="s.sonosCostDiscount" placeholder="Not set"><small class="muted">Internal, for the profit figure. Off the Sonos UK price ex VAT</small></label>
        <label class="check span-2"><input type="checkbox" v-model="s.includeSurcharges"> Include Ubiquiti surcharges in prices</label>
      </div>
      <h3 class="sub-title">What proposals show</h3>
      <div class="layout-choice">
        <label class="choice" :class="{ active: s.display.layout !== 'summary' }">
          <input type="radio" value="detailed" v-model="s.display.layout">
          <span><b>Every item</b><small>Each product with its quantity and price</small></span>
        </label>
        <label class="choice" :class="{ active: s.display.layout === 'summary' }">
          <input type="radio" value="summary" v-model="s.display.layout">
          <span><b>Area totals only</b><small>What's in each area, with one price per area</small></span>
        </label>
      </div>
      <div class="checks">
        <label class="check"><input type="checkbox" v-model="s.display.showImages"> Product images</label>
        <label class="check"><input type="checkbox" v-model="s.display.showItemPrices"> Price of each item</label>
        <label class="check"><input type="checkbox" v-model="s.display.showSku"> Manufacturer and model numbers</label>
        <label class="check"><input type="checkbox" v-model="s.display.showLabourDetail"> Labour under each item</label>
        <label class="check"><input type="checkbox" v-model="s.display.frontCover"> Front cover (the house picture)</label>
      </div>
      <label class="inline-select">Labour
        <select v-model="s.display.labourPlacement">
          <option value="area">At the bottom of each area</option>
          <option value="end">In one section after the areas</option>
        </select>
      </label>
    </section>

    <section class="card">
      <h2 class="card-title">Default proposal text</h2>
      <label class="stack">Introduction<AutoTextarea v-model="s.defaultIntro" :rows="3" /></label>
      <label class="stack">Starting text sections (headings for new quotes)</label>
      <div class="rate-row" v-for="(sc, i) in s.defaultScope" :key="i">
        <input v-model="sc.heading" aria-label="Section heading">
        <button class="icon-btn danger" title="Remove" @click="s.defaultScope.splice(i, 1)">✕</button>
      </div>
      <button class="btn" @click="addScope">+ Add section</button>
      <label class="stack">Terms (one per line)<AutoTextarea v-model="s.defaultTerms" :rows="6" /></label>
      <p class="muted sm">These are example terms — please check them before sending proposals.</p>
    </section>

    <Transition name="modal"><Modal v-if="restart" title="Start quote numbers again" @close="restart = null">
      <p style="margin-top: 0">The next new quote will be <b>{{ quoteNumber(1) }}</b>.</p>
      <p class="muted" v-if="restart.count === null">Checking your quotes…</p>
      <template v-else-if="restart.count">
        <p>You have {{ restart.count }} quote{{ restart.count === 1 ? '' : 's' }} ({{ restart.range }}). {{ restart.count === 1 ? 'It needs' : 'They need' }} to be deleted first, so no two quotes end up with the same number.</p>
        <label class="check restart-check"><input type="checkbox" v-model="restart.deleteQuotes"> <span>Delete all {{ restart.count }} quote{{ restart.count === 1 ? '' : 's' }} too, with their client links, views and versions. <b>This can't be undone.</b></span></label>
        <label class="stack" v-if="restart.deleteQuotes">Type DELETE to confirm<input v-model="restart.confirm" autocomplete="off" placeholder="DELETE"></label>
      </template>
      <p class="muted" v-else>You have no quotes, so nothing else changes.</p>
      <p class="muted sm">Settings, products and kits are kept.</p>
      <template #footer>
        <button class="btn" @click="restart = null">Cancel</button>
        <button class="btn" :class="restart.deleteQuotes ? 'danger-fill' : 'primary'" @click="doRestart"
          :disabled="restart.busy || restart.count === null || (restart.count > 0 && !(restart.deleteQuotes && restart.confirm.trim().toUpperCase() === 'DELETE'))">
          {{ restart.busy ? 'Working…' : restart.deleteQuotes ? 'Delete quotes and start again' : 'Start again from ' + quoteNumber(1) }}
        </button>
      </template>
    </Modal></Transition>
  </div>`,
};

// ---- The light switch ---------------------------------------------------------------

const LightSwitch = {
  props: { modelValue: String },
  emits: ['update:modelValue'],
  computed: {
    on() {
      return this.modelValue !== 'dark';
    },
  },
  template: `
    <button type="button" class="light-switch" :class="modelValue" role="switch" :aria-checked="on ? 'true' : 'false'"
      aria-label="Light mode" :title="on ? 'Turn the lights off (dark mode)' : 'Turn the lights on (light mode)'"
      @click="$emit('update:modelValue', on ? 'dark' : 'light')">
      <span class="ls-plate" aria-hidden="true"><span class="ls-rocker"></span></span>
    </button>`,
};

// ---- Numbers that roll to their new value ----------------------------------------------
// <AnimatedNumber :value="pence" money /> rolls smoothly whenever the value changes.
// With from-zero it also counts up when it first appears.

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const AnimatedNumber = {
  props: { value: { type: Number, default: 0 }, money: Boolean, fromZero: Boolean },
  data() {
    return { shown: this.fromZero && !prefersReducedMotion() ? 0 : this.value || 0 };
  },
  computed: {
    text() {
      const n = Math.round(this.shown);
      return this.money ? money(n) : String(n);
    },
  },
  watch: {
    value(to) {
      this.roll(to || 0, 550);
    },
  },
  mounted() {
    if (this.shown !== (this.value || 0)) this.roll(this.value || 0, 900);
  },
  beforeUnmount() {
    cancelAnimationFrame(this.raf);
  },
  methods: {
    roll(to, duration) {
      cancelAnimationFrame(this.raf);
      if (prefersReducedMotion()) return (this.shown = to);
      const from = this.shown;
      const start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // fast start, gentle finish
        this.shown = from + (to - from) * eased;
        if (p < 1) this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    },
  },
  template: `<span class="anim-num">{{ text }}</span>`,
};

// ---- Moving mesh behind the page tops ------------------------------------------------

const MeshBand = {
  mounted() {
    this.mesh = window.MeshNodes ? window.MeshNodes.attach(this.$el) : null;
  },
  beforeUnmount() {
    if (this.mesh) this.mesh.destroy();
  },
  template: `<canvas class="band-canvas" aria-hidden="true"></canvas>`,
};

// ---- Sliding underline for tab bars ----------------------------------------------------
// Add v-tab-ink to a .tabs bar: the blue line glides to the active tab.

const tabInk = {
  mounted(el) {
    const ink = {
      active: null,
      place(instant) {
        const btn = el.querySelector(':scope > button.active');
        if (!btn) return el.style.setProperty('--ink-o', '0');
        const x = btn.offsetLeft;
        const w = btn.offsetWidth;
        if (x === ink.x && w === ink.w) return; // nothing moved
        ink.x = x;
        ink.w = w;
        el.classList.toggle('ink-instant', !!instant);
        el.style.setProperty('--ink-x', `${x}px`);
        el.style.setProperty('--ink-w', `${w}px`);
        el.style.setProperty('--ink-o', '1');
        if (instant) requestAnimationFrame(() => el.classList.remove('ink-instant'));
      },
      watch() {
        const btn = el.querySelector(':scope > button.active');
        if (btn === ink.active) return false;
        if (ink.active) ink.sizes.unobserve(ink.active);
        ink.active = btn;
        if (btn) ink.sizes.observe(btn);
        return true;
      },
    };
    // Re-measure when the bar or the active tab changes size (fonts loading, counts).
    ink.sizes = new ResizeObserver(() => ink.place(true));
    ink.sizes.observe(el);
    el._ink = ink;
    el.classList.add('has-ink');
    ink.watch();
    ink.place(true);
  },
  updated(el) {
    const ink = el._ink;
    if (ink && ink.watch()) ink.place(false);
  },
  unmounted(el) {
    if (el._ink) el._ink.sizes.disconnect();
  },
};

// ---- App shell ---------------------------------------------------------------------

const App = {
  components: { QuotesList, QuoteEditor, ProductsPage, SettingsPage, LightSwitch },
  computed: {
    route: () => state.route,
    toasts: () => state.toasts,
    ready: () => !!state.settings,
    session: () => state.session,
    setupMessage: () => state.setupMessage,
    team() {
      return (state.settings?.team || []).map((m) => m.name).filter(Boolean);
    },
    me: {
      get: () => state.me,
      set(v) {
        state.me = v;
        storageSet('mesh.me', v);
      },
    },
    theme: {
      get: () => state.theme,
      set(v) {
        state.theme = v;
        storageSet(THEME_KEY, v);
        applyTheme(v, true);
      },
    },
  },
  async mounted() {
    try {
      state.session = await api('GET', '/api/session');
    } catch (err) {
      return toast(`Could not reach the server: ${err.message}`, 'error');
    }
    if (state.session.setupMessage) {
      state.setupMessage = state.session.setupMessage;
      return;
    }
    if (!state.session.signedIn) return goToSignIn();
    try {
      state.settings = await api('GET', '/api/settings');
    } catch (err) {
      if (err.status !== 401) toast(`Could not load settings: ${err.message}`, 'error');
    }
  },
  methods: { signOut },
  template: `
  <header class="app-header">
    <a href="#/" class="brand"><img src="/img/mesh-logo-white.png" alt="Mesh"><span>Quotes</span></a>
    <nav>
      <a href="#/" :class="{ active: route.name === 'quotes' || route.name === 'quote' }">Quotes</a>
      <a href="#/products" :class="{ active: route.name === 'products' }">Products</a>
      <a href="#/settings" :class="{ active: route.name === 'settings' }">Settings</a>
    </nav>
    <div class="header-right">
      <label class="me" v-if="team.length">
        <span>You are</span>
        <select v-model="me"><option value="">—</option><option v-for="n in team" :value="n">{{ n }}</option></select>
      </label>
      <button v-if="session && session.authEnabled" class="sign-out" @click="signOut">Sign out</button>
      <LightSwitch v-model="theme" />
    </div>
  </header>
  <div class="page" v-if="setupMessage">
    <div class="card empty-state">
      <div class="es-mark"></div>
      <h2>One more setup step</h2>
      <p class="muted">{{ setupMessage }}</p>
      <p class="muted sm">The README in the GitHub repo walks through the Vercel setup.</p>
    </div>
  </div>
  <main v-else-if="ready">
    <QuotesList v-if="route.name === 'quotes'" />
    <QuoteEditor v-else-if="route.name === 'quote'" :id="route.id" :key="route.id" />
    <ProductsPage v-else-if="route.name === 'products'" />
    <SettingsPage v-else-if="route.name === 'settings'" />
  </main>
  <TransitionGroup tag="div" class="toasts" name="toast" aria-live="polite">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type" :style="{ '--life': t.life + 'ms' }">{{ t.msg }}</div>
  </TransitionGroup>`,
};

const app = createApp(App);
app.component('MeshBand', MeshBand);
app.component('AnimatedNumber', AnimatedNumber);
app.directive('tab-ink', tabInk);
app.mount('#app');
