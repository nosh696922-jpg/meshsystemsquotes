// Saved versions of a quote, so you can see what changed and when, and go
// back to an earlier one. A version is saved:
//   - when someone clicks "Save version" in the editor,
//   - when the client link is copied (if anything changed since last time),
//   - when the client accepts, declines or asks for changes,
//   - just before an older version is restored.

const store = require('./store');
const calc = require('../public/shared/calc');

const MAX_VERSIONS = 40;
const KINDS = ['manual', 'sent', 'accept', 'changes', 'decline', 'restore'];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function text(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// Everything that shows on the proposal; not status or timestamps.
function contentOf(quote) {
  const { updatedAt, createdAt, status, clientResponse, ...rest } = quote;
  return JSON.stringify(rest);
}

async function list(id) {
  return store.getRevisions(id);
}

async function add(quote, { kind = 'manual', note = '', by = '', force = false } = {}) {
  const revisions = await store.getRevisions(quote.id);
  const last = revisions[revisions.length - 1];
  if (!force && last && contentOf(last.quote) === contentOf(quote)) return { skipped: true, revision: last };
  const totals = calc.quoteTotals(quote);
  const revision = {
    n: (last?.n || 0) + 1,
    at: new Date().toISOString(),
    kind: KINDS.includes(kind) ? kind : 'manual',
    note: text(note, 200),
    by: text(by, 120),
    status: quote.status,
    subtotal: totals.subtotal,
    total: totals.total,
    quote: JSON.parse(JSON.stringify(quote)),
  };
  revisions.push(revision);
  // Keep the newest ones, but never drop the version a client accepted.
  while (revisions.length > MAX_VERSIONS) {
    const i = revisions.findIndex((r) => r.kind !== 'accept');
    revisions.splice(i < 0 ? 0 : i, 1);
  }
  await store.saveRevisions(quote.id, revisions);
  return { revision };
}

// Put an older version back. The current one is saved first, so it can be undone.
async function restore(id, n, by = '') {
  const quote = await store.getQuote(id);
  if (!quote) throw httpError(404, 'Quote not found');
  const revisions = await store.getRevisions(id);
  const revision = revisions.find((r) => r.n === Number(n));
  if (!revision) throw httpError(404, 'Version not found');
  await add(quote, { kind: 'restore', note: `Before going back to version ${revision.n}`, by });
  const restored = {
    ...JSON.parse(JSON.stringify(revision.quote)),
    id: quote.id,
    number: quote.number,
    createdAt: quote.createdAt,
    status: quote.status,
    clientResponse: quote.clientResponse || null,
    updatedAt: new Date().toISOString(),
  };
  await store.saveQuote(restored);
  return restored;
}

module.exports = { list, add, restore, KINDS };
