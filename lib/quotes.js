const store = require('./store');
const calc = require('../public/shared/calc');
const client = require('./client');

const STATUSES = ['draft', 'sent', 'changes', 'accepted', 'declined'];

// Quote ids double as the client's private link, so make them hard to guess.
const newQuoteId = () => store.newId('q', 10);

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function createQuote({ preparedBy = '' } = {}) {
  const settings = await store.getSettings();
  const now = new Date().toISOString();
  const quote = {
    id: newQuoteId(),
    number: await store.takeQuoteNumber(),
    title: 'New proposal',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    preparedBy: String(preparedBy || ''),
    date: today(),
    validDays: settings.validDays,
    client: { name: '', company: '', email: '', phone: '', address: '' },
    siteAddress: '',
    intro: settings.defaultIntro,
    scope: (settings.defaultScope || []).map((s) => ({ id: store.newId('s'), heading: s.heading, body: s.body })),
    sections: [{ id: store.newId('a'), name: 'Main area', description: '', items: [] }],
    labourTypes: JSON.parse(JSON.stringify(settings.labourTypes)),
    vatRate: settings.vatRate,
    markup: settings.markup,
    costDiscount: settings.costDiscount || 0,
    sonosCostDiscount: settings.sonosCostDiscount ?? null,
    discount: { type: 'none', percent: null, amount: null, label: '' },
    includeSurcharges: settings.includeSurcharges,
    terms: settings.defaultTerms,
    display: { ...settings.display },
    notes: '',
  };
  return store.saveQuote(quote);
}

async function duplicateQuote(id) {
  const original = await store.getQuote(id);
  if (!original) return null;
  const now = new Date().toISOString();
  const copy = JSON.parse(JSON.stringify(original));
  copy.id = newQuoteId();
  copy.number = await store.takeQuoteNumber();
  copy.title = `${original.title} (copy)`;
  copy.status = 'draft';
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.date = today();
  copy.clientResponse = null;
  return store.saveQuote(copy);
}

// Accept an edited quote from the browser. Returns { conflict } if someone
// else saved the quote since the editor loaded it.
async function updateQuote(id, incoming, baseUpdatedAt) {
  const current = await store.getQuote(id);
  if (!current) return { notFound: true };
  if (!incoming || typeof incoming !== 'object') {
    throw Object.assign(new Error('Missing quote'), { status: 400 });
  }
  if (baseUpdatedAt && current.updatedAt !== baseUpdatedAt) {
    return { conflict: true, current };
  }
  const next = {
    ...incoming,
    id: current.id,
    number: incoming.number || current.number,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    status: STATUSES.includes(incoming.status) ? incoming.status : current.status,
    // Only the client can reply; the editor can't change or remove a reply.
    clientResponse: current.clientResponse || null,
  };
  await store.saveQuote(next);
  return { quote: next };
}

// Start quote numbers again from 0001, e.g. after testing. Can delete every
// quote first; refuses while quotes remain, so no two quotes share a number.
async function restartNumbering({ deleteQuotes = false } = {}) {
  let deleted = 0;
  if (deleteQuotes) {
    for (const quote of await store.listQuotes()) {
      await store.deleteQuote(quote.id);
      deleted += 1;
    }
  }
  const remaining = (await store.listQuotes()).length;
  if (remaining) {
    throw Object.assign(
      new Error(`There ${remaining === 1 ? 'is still 1 quote' : `are still ${remaining} quotes`}. Delete ${remaining === 1 ? 'it' : 'them'} first so no two quotes share a number.`),
      { status: 409 },
    );
  }
  await store.resetQuoteNumbers();
  return { deleted, nextQuoteNumber: (await store.getSettings()).nextQuoteNumber };
}

function summarise(quote) {
  const totals = calc.quoteTotals(quote);
  const items = (quote.sections || []).reduce((n, s) => n + (s.items || []).length, 0);
  return {
    id: quote.id,
    number: quote.number,
    title: quote.title,
    status: quote.status,
    client: quote.client?.company || quote.client?.name || '',
    preparedBy: quote.preparedBy,
    date: quote.date,
    items,
    subtotal: totals.subtotal,
    total: totals.total,
    createdAt: quote.createdAt,
    updatedAt: quote.updatedAt,
  };
}

async function listSummaries() {
  const list = (await store.listQuotes()).map(summarise);
  const activity = await client.summaries(list.map((q) => q.id));
  return list
    .map((q) => ({ ...q, ...activity[q.id] }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

module.exports = { createQuote, duplicateQuote, updateQuote, listSummaries, restartNumbering, STATUSES };
