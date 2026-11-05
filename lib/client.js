// What clients do with their proposal link: when they open it, and their reply
// (accept, ask for changes, or decline).
//
// Views are kept apart from the quote, so a client opening the link never
// clashes with someone editing the quote at the same time.

const store = require('./store');
const calc = require('../public/shared/calc');
const revisions = require('./revisions');

// Link previews (WhatsApp, iMessage, Slack, email scanners) aren't people.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|skype|linkedin|embedly|pinterest|headless|lighthouse|curl|wget|python|node-fetch|axios|go-http|java\//i;

const RESULT = { accept: 'accepted', changes: 'changes', decline: 'declined' };
const LABEL = { accept: 'Accepted', changes: 'Changes requested', decline: 'Declined' };

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function blank() {
  return { views: { count: 0, first: null, last: null, recent: [] }, responses: [] };
}

function normalise(a) {
  const b = blank();
  if (!a) return b;
  return { ...b, ...a, views: { ...b.views, ...(a.views || {}) }, responses: a.responses || [] };
}

async function getActivity(id) {
  return normalise(await store.getActivity(id));
}

function isBot(userAgent) {
  return !userAgent || BOT.test(userAgent);
}

function device(userAgent) {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|android/i.test(userAgent)) return 'phone';
  return 'computer';
}

// newVisit is false when the same browser opened it in the last half hour,
// so refreshing the page doesn't count as another view.
async function recordView(id, userAgent, newVisit) {
  const a = await getActivity(id);
  const now = new Date().toISOString();
  a.views.first ||= now;
  a.views.last = now;
  if (newVisit) {
    a.views.count += 1;
    a.views.recent.unshift({ at: now, device: device(userAgent) });
    a.views.recent = a.views.recent.slice(0, 30);
  }
  await store.saveActivity(id, a);
}

// Short summaries for the quotes list.
async function summaries(ids) {
  const all = ids.length ? await store.listActivity(ids) : [];
  const out = {};
  ids.forEach((id, i) => {
    const a = normalise(all[i]);
    const r = a.responses[0];
    out[id] = {
      views: a.views.count,
      lastViewed: a.views.last,
      response: r ? { action: r.action, name: r.name, at: r.at } : null,
    };
  });
  return out;
}

// ---- Replies ------------------------------------------------------------------

function line(v, max) {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function paragraph(v, max) {
  return String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

// A few replies per address, then a pause (stops someone flooding a quote).
const recent = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;

function tooMany(address) {
  const now = Date.now();
  const entry = recent.get(address);
  if (!entry || now - entry.first > WINDOW_MS) {
    recent.set(address, { first: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

async function respond(id, body, address) {
  if (tooMany(address)) throw httpError(429, 'Too many replies from here. Please wait a few minutes and try again.');
  const quote = await store.getQuote(id);
  if (!quote) throw httpError(404, 'Proposal not found');

  const action = String(body?.action || '');
  if (!RESULT[action]) throw httpError(400, 'Unknown reply');
  const name = line(body.name, 120);
  const email = line(body.email, 160);
  const po = line(body.po, 60);
  const message = paragraph(body.message, 2000);
  if (name.length < 2) throw httpError(400, 'Please enter your name.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw httpError(400, 'That email address does not look right.');
  if (action === 'accept' && body.agree !== true) throw httpError(400, 'Please tick the box to confirm you accept the proposal.');
  if (action === 'changes' && !message) throw httpError(400, 'Please tell us what you would like changed.');
  if (quote.status === 'accepted') throw httpError(409, 'This proposal has already been accepted.');
  if (action === 'accept' && calc.isExpired(quote)) {
    throw httpError(400, 'This proposal has passed its valid-until date. Please request an updated proposal.');
  }

  const totals = calc.quoteTotals(quote);
  const now = new Date().toISOString();
  const response = { id: store.newId('r'), action, name, email, po, message, at: now, subtotal: totals.subtotal, total: totals.total };
  quote.status = RESULT[action];
  quote.clientResponse = response;
  quote.updatedAt = now;
  await store.saveQuote(quote);

  const a = await getActivity(id);
  a.responses.unshift(response);
  a.responses = a.responses.slice(0, 50);
  await store.saveActivity(id, a);

  // Keep a copy of exactly what the client saw when they replied.
  await revisions.add(quote, { kind: action, note: `${LABEL[action]} by ${name}`, by: name, force: true });
  return { ok: true, status: quote.status };
}

module.exports = { getActivity, recordView, summaries, respond, isBot };
