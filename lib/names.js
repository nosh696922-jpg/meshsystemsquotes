// Our own names for catalogue products, used in place of the maker's name
// whenever the product is added to a quote. For example, a Ubiquiti UCG-Max
// can be added as "Home network router". Keyed by catalogue product id.

const store = require('./store');

const MAX_NAMES = 5000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function list() {
  return { names: await store.getProductNames() };
}

// Save one name. An empty name goes back to the maker's name.
async function set(input) {
  const id = String(input?.id ?? '').trim();
  const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!id || id.length > 200 || !id.includes(':')) throw httpError(400, 'Unknown product');
  const names = await store.getProductNames();
  if (name) {
    if (!(id in names) && Object.keys(names).length >= MAX_NAMES) throw httpError(400, `Up to ${MAX_NAMES} names can be saved.`);
    names[id] = name;
  } else {
    delete names[id];
  }
  await store.saveProductNames(names);
  return { names };
}

module.exports = { list, set };
