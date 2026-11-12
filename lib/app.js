// Request handler shared by the local server (server.js) and Vercel (api/index.js).

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const store = require('./store');
const auth = require('./auth');
const catalogue = require('./catalogue');
const quotes = require('./quotes');
const client = require('./client');
const revisions = require('./revisions');
const kits = require('./kits');
const names = require('./names');
const habitechBasket = require('./habitech-basket');
const { renderProposal } = require('./proposal');
const { renderPdf, findBrowser } = require('./pdf');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  // Keep proposal links private: never send them to other sites (e.g. image hosts).
  'Referrer-Policy': 'no-referrer',
};

// ---- Helpers ----------------------------------------------------------------

function send(req, res, status, body, type = 'application/json; charset=utf-8', extraHeaders = {}) {
  let payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  const headers = { ...BASE_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extraHeaders };
  const big = (Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload)) > 2048;
  if (big && /gzip/.test(req.headers['accept-encoding'] || '') && !/pdf|image|font/.test(type)) {
    payload = zlib.gzipSync(payload);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(status, headers);
  res.end(payload);
}

function readBody(req) {
  // Some hosts parse the body before we see it.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.length ? JSON.parse(req.body.toString('utf8')) : {});
    return Promise.resolve(req.body || {});
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  let file;
  try {
    file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
  } catch {
    return send(req, res, 400, 'Bad request', 'text/plain');
  }
  if (!file.startsWith(PUBLIC_DIR)) return send(req, res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, data) => {
    if (err) return send(req, res, 404, 'Not found', 'text/plain');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const cache = /\.(woff2|png|jpg|svg|ico)$/.test(file) || file.includes(`${path.sep}vendor${path.sep}`) ? 'public, max-age=86400' : 'no-cache';
    send(req, res, 200, data, type, { 'Cache-Control': cache });
  });
}

function slugify(s) {
  return String(s || 'proposal').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'proposal';
}

function httpError(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra });
}

function pdfAvailable() {
  return Boolean(findBrowser());
}

// Problems that stop the team app working online, in the order to fix them.
function setupProblem() {
  if (store.ON_VERCEL && !auth.enabled()) {
    return { setup: 'password', message: 'Set a team password first. In Vercel, open this project → Settings → Environment Variables, add TEAM_PASSWORD, then redeploy.' };
  }
  if (!store.info().ready) {
    return { setup: 'storage', message: 'No database connected. In Vercel, open this project → Storage, connect “Upstash for Redis”, then redeploy.' };
  }
  return null;
}

// ---- Routes -----------------------------------------------------------------

const routes = [];
function route(method, pattern, handler, { open = false } = {}) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, regex, keys, handler, open });
}

// Open routes (no sign-in) ----------------------------------------------------

route(
  'GET',
  '/api/session',
  ({ req }) => {
    const problem = setupProblem();
    return {
      authEnabled: auth.enabled(),
      signedIn: auth.isSignedIn(req),
      storage: store.info().name,
      setup: problem?.setup || null,
      setupMessage: problem?.message || null,
      pdf: pdfAvailable() ? 'direct' : 'print',
    };
  },
  { open: true },
);

route(
  'POST',
  '/api/login',
  async ({ req }) => {
    if (!auth.enabled()) return { ok: true };
    if (auth.tooManyAttempts(req)) throw httpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
    const { password } = await readBody(req);
    if (!auth.checkPassword(password)) {
      auth.recordFailure(req);
      await new Promise((r) => setTimeout(r, 600));
      throw httpError(401, 'That password is not right.');
    }
    auth.clearFailures(req);
    return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': auth.signInCookie(req) } };
  },
  { open: true },
);

route('POST', '/api/logout', ({ req }) => ({ status: 200, body: { ok: true }, headers: { 'Set-Cookie': auth.signOutCookie(req) } }), {
  open: true,
});

// Daily price refresh (Vercel Cron calls this). Only refreshes when the prices
// are more than ~20 hours old, so calling it more often does nothing.
route(
  'GET',
  '/api/cron/refresh',
  async ({ req }) => {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) throw httpError(401, 'Not allowed');
    if (setupProblem()?.setup === 'storage') throw httpError(503, 'No database connected');
    // Vercel stops a request after 60 seconds, so finish (and save) by ~50.
    const deadline = store.ON_VERCEL ? Date.now() + 50_000 : Infinity;
    return { results: await catalogue.refreshStale(20 * 60 * 60 * 1000, { deadline }) };
  },
  { open: true },
);

// The client-facing proposal. Anyone with the link can view it.
route(
  'GET',
  '/p/:id',
  async ({ req, params, url }) => {
    if (!store.info().ready) return { status: 503, type: 'text/plain; charset=utf-8', body: 'This proposal is not available right now.' };
    const quote = await store.getQuote(params.id);
    if (!quote) return { status: 404, type: 'text/plain; charset=utf-8', body: 'Proposal not found' };
    const print = url.searchParams.has('print');
    const headers = { 'X-Robots-Tag': 'noindex, nofollow' };

    // Count the client opening it (not the team, not link previews).
    const userAgent = String(req.headers['user-agent'] || '');
    if (!print && auth.enabled() && !auth.isSignedIn(req) && !client.isBot(userAgent)) {
      const cookie = `mv_${quote.id}`;
      try {
        await client.recordView(quote.id, userAgent, !auth.cookies(req)[cookie]);
      } catch (err) {
        console.error(`[views] ${err.message}`);
      }
      headers['Set-Cookie'] = `${cookie}=1; Path=/p/${quote.id}; Max-Age=1800; HttpOnly; SameSite=Lax${auth.isHttps(req) ? '; Secure' : ''}`;
    }

    const versions = await revisions.list(quote.id).catch(() => []);
    const html = renderProposal(quote, await store.getSettings(), {
      print,
      revision: revisions.revisionNumber(quote, versions),
      autoPrint: url.searchParams.get('save') === 'pdf',
      editorLink: auth.enabled() ? auth.isSignedIn(req) : !store.ON_VERCEL,
      pdfDirect: pdfAvailable(),
      justReplied: url.searchParams.get('done') || '',
    });
    return { status: 200, type: MIME['.html'], body: html, headers };
  },
  { open: true },
);

route(
  'GET',
  '/p/:id/pdf',
  async ({ req, params }) => {
    if (!store.info().ready) return { status: 503, type: 'text/plain; charset=utf-8', body: 'This proposal is not available right now.' };
    const quote = await store.getQuote(params.id);
    if (!quote) return { status: 404, type: 'text/plain; charset=utf-8', body: 'Proposal not found' };
    // No browser to make the PDF here (e.g. on Vercel): open the print window instead.
    if (!pdfAvailable()) return { status: 302, body: '', headers: { Location: `/p/${encodeURIComponent(quote.id)}?save=pdf` } };
    const port = req.socket?.localPort || process.env.PORT || 3000;
    const pdf = await renderPdf(`http://127.0.0.1:${port}/p/${encodeURIComponent(quote.id)}?print=1`);
    const name = `${slugify(quote.number)}-${slugify(quote.title)}.pdf`;
    return {
      status: 200,
      type: 'application/pdf',
      body: pdf,
      headers: { 'Content-Disposition': `inline; filename="${name}"`, 'X-Robots-Tag': 'noindex, nofollow' },
    };
  },
  { open: true },
);

// The client's reply: accept, ask for changes, or decline.
route(
  'POST',
  '/p/:id/respond',
  async ({ req, params }) => {
    if (!store.info().ready) throw httpError(503, 'This proposal is not available right now.');
    // JSON only, so other websites can't post a reply on someone's behalf.
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) throw httpError(415, 'Please reply from the proposal page.');
    return client.respond(params.id, await readBody(req), auth.clientAddress(req));
  },
  { open: true },
);

// Team routes (sign-in needed) -------------------------------------------------

route('GET', '/api/settings', () => store.getSettings());
route('PUT', '/api/settings', async ({ req }) => store.saveSettings(await readBody(req)));
// Start quote numbers again from 0001 (optionally deleting every quote first).
route('POST', '/api/settings/restart-numbering', async ({ req }) => {
  const body = await readBody(req);
  if (body.deleteQuotes && body.confirm !== 'DELETE') throw httpError(400, 'Type DELETE to confirm deleting all quotes.');
  return quotes.restartNumbering({ deleteQuotes: Boolean(body.deleteQuotes) });
});

route('GET', '/api/catalogue', async () => ({ products: await catalogue.allProducts(), sources: await catalogue.sourcesInfo() }));
route('GET', '/api/catalogue/status', async () => ({ sources: await catalogue.sourcesInfo() }));
route('POST', '/api/catalogue/:source/sync', async ({ params }) => {
  await catalogue.syncSource(params.source).catch(() => {}); // the error is reported in the status
  return { sources: await catalogue.sourcesInfo() };
});
// Import a supplier's price list file, sent as base64 JSON: { file, fileName }.
route('POST', '/api/catalogue/:source/import', async ({ req, params }) => {
  const body = await readBody(req);
  if (typeof body.file !== 'string' || !body.file) throw httpError(400, 'Choose a price list file to import.');
  const result = await catalogue.importSource(params.source, Buffer.from(body.file, 'base64'), body.fileName);
  return { result, sources: await catalogue.sourcesInfo() };
});
// Live catalogues (Habitech): searched as you type; quotes check their prices in bulk.
route('GET', '/api/catalogue/:source/search', ({ params, url }) =>
  catalogue.liveSearch(params.source, url.searchParams.get('q'), url.searchParams.get('offset')),
);
route('GET', '/api/catalogue/:source/products/:sku', async ({ params }) => ({ product: await catalogue.liveProduct(params.source, params.sku) }));
route('POST', '/api/catalogue/:source/prices', async ({ req, params }) => ({ prices: await catalogue.livePrices(params.source, (await readBody(req)).skus) }));
route('GET', '/api/catalogue/:source/status', ({ params }) => catalogue.liveStatus(params.source));
// The copy of a live catalogue, for browsing (compact rows; the app expands them).
route('GET', '/api/catalogue/:source/products', ({ params }) => catalogue.liveCopy(params.source));
// One step of copying (about 40 seconds); the app calls it again until it's done.
route('POST', '/api/catalogue/:source/copy', async ({ req, params }) => {
  const body = await readBody(req);
  await catalogue.copyLive(params.source, { deadline: Date.now() + 40_000, restart: Boolean(body.restart) });
  return catalogue.liveStatus(params.source);
});

route('POST', '/api/products/custom', async ({ req }) => catalogue.addCustomProduct(await readBody(req)));
route('PUT', '/api/products/custom/:id', async ({ req, params }) => {
  const product = await catalogue.updateCustomProduct(params.id, await readBody(req));
  if (!product) throw httpError(404, 'Product not found');
  return product;
});
route('DELETE', '/api/products/custom/:id', async ({ params }) => {
  await catalogue.deleteCustomProduct(params.id);
  return { ok: true };
});

route('GET', '/api/quotes', () => quotes.listSummaries());
route('POST', '/api/quotes', async ({ req }) => quotes.createQuote(await readBody(req)));
route('GET', '/api/quotes/:id', async ({ params }) => {
  const quote = await store.getQuote(params.id);
  if (!quote) throw httpError(404, 'Quote not found');
  return quote;
});
route('PUT', '/api/quotes/:id', async ({ req, params }) => {
  const body = await readBody(req);
  const result = await quotes.updateQuote(params.id, body.quote, body.baseUpdatedAt);
  if (result.notFound) throw httpError(404, 'Quote not found');
  if (result.conflict) return { status: 409, body: { error: 'conflict', current: result.current } };
  return result.quote;
});
route('DELETE', '/api/quotes/:id', async ({ params }) => {
  await store.deleteQuote(params.id);
  return { ok: true };
});
route('POST', '/api/quotes/:id/duplicate', async ({ params }) => {
  const copy = await quotes.duplicateQuote(params.id);
  if (!copy) throw httpError(404, 'Quote not found');
  return copy;
});

route('GET', '/api/quotes/:id/activity', ({ params }) => client.getActivity(params.id));

route('GET', '/api/quotes/:id/revisions', ({ params }) => revisions.list(params.id));
route('POST', '/api/quotes/:id/revisions', async ({ req, params }) => {
  const quote = await store.getQuote(params.id);
  if (!quote) throw httpError(404, 'Quote not found');
  const body = await readBody(req);
  return revisions.add(quote, { kind: body.kind === 'sent' ? 'sent' : 'manual', note: body.note, by: body.by });
});
route('POST', '/api/quotes/:id/revisions/:n/restore', async ({ req, params }) => {
  const body = await readBody(req);
  return revisions.restore(params.id, params.n, body.by);
});

route('GET', '/api/kits', () => kits.list());
route('POST', '/api/kits', async ({ req }) => kits.add(await readBody(req)));
route('PUT', '/api/kits/:id', async ({ req, params }) => kits.update(params.id, await readBody(req)));
route('DELETE', '/api/kits/:id', async ({ params }) => {
  await kits.remove(params.id);
  return { ok: true };
});

route('GET', '/api/product-names', () => names.list());
route('PUT', '/api/product-names', async ({ req }) => names.set(await readBody(req)));

// Habitech website item numbers for a quote's Habitech products, for the
// "Add to Habitech basket" link.
route('POST', '/api/habitech/basket', async ({ req }) => habitechBasket.find((await readBody(req)).skus));

// ---- Handler --------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const match = routes
    .filter((r) => r.method === req.method)
    .map((r) => ({ r, m: url.pathname.match(r.regex) }))
    .find((x) => x.m);

  if (!match) {
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    return send(req, res, 404, { error: 'Not found' });
  }

  try {
    if (!match.r.open) {
      const problem = setupProblem();
      if (problem) throw httpError(503, problem.message, { setup: problem.setup });
      if (!auth.isSignedIn(req)) throw httpError(401, 'Please sign in');
    }

    const params = {};
    match.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(match.m[i + 1])));
    const result = await match.r.handler({ req, res, params, url });
    if (result && result.status && 'body' in result) {
      return send(req, res, result.status, result.body, result.type, result.headers);
    }
    send(req, res, 200, result ?? { ok: true });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500 && !err.setup) console.error(err);
    send(req, res, status, { error: err.message || 'Something went wrong', setup: err.setup || null });
  }
}

module.exports = { handle, routes };
