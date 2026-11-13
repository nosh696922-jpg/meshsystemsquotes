// Developer options (the Dev page in the app).
//
// These routes are for the signed-in team, like every other /api route. The
// secret word in the app only hides the page; it isn't a lock. So nothing
// here shows API keys or the team password, and nothing deletes data.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const catalogue = require('./catalogue');
const habitech = require('./catalogues/habitech');
const netxl = require('./catalogues/netxl');
const pkg = require('../package.json');

const NIGHTLY = 'nightly-job'; // the nightly job's last results, saved as catalogue "nightly-job"
const DAY = 24 * 60 * 60 * 1000;

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

// The code this server is running: Vercel says which commit it deployed; on
// your own computer, read it from the .git folder.
function commit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return {
      sha: process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7),
      message: (process.env.VERCEL_GIT_COMMIT_MESSAGE || '').split('\n')[0] || null,
      branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    };
  }
  try {
    const git = path.join(__dirname, '..', '.git');
    const head = fs.readFileSync(path.join(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return { sha: head.slice(0, 7), message: null, branch: null };
    const ref = head.slice(5);
    const loose = path.join(git, ref);
    const sha = fs.existsSync(loose)
      ? fs.readFileSync(loose, 'utf8').trim()
      : (fs.readFileSync(path.join(git, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`)) || '').split(' ')[0];
    return { sha: sha.slice(0, 7) || null, message: null, branch: ref.replace('refs/heads/', '') };
  } catch {
    return null;
  }
}

async function info() {
  const quotes = await store.listQuotes();
  const [sources, kits, names, nightly] = await Promise.all([
    catalogue.sourcesInfo(),
    store.getKits(),
    store.getProductNames(),
    store.getCatalogue(NIGHTLY).catch(() => null),
  ]);
  const live = {};
  for (const s of sources.filter((x) => x.kind === 'live')) {
    live[s.id] = await catalogue.liveStatus(s.id).catch((err) => ({ error: err.message }));
  }
  return {
    version: pkg.version,
    commit: commit(),
    server: {
      node: process.version,
      onVercel: store.ON_VERCEL,
      region: process.env.VERCEL_REGION || null,
      time: new Date().toISOString(),
    },
    storage: store.info(),
    // Only whether each one is set, never its value.
    settingsSet: {
      TEAM_PASSWORD: Boolean(process.env.TEAM_PASSWORD),
      HABITECH_API_KEY: habitech.configured(),
      NETXL_API_KEY: netxl.configured(),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
    },
    counts: { quotes: quotes.length, kits: kits.length, productNames: Object.keys(names).length },
    catalogues: sources,
    live,
    nightly,
  };
}

// A quick request to a supplier, to check its key works.
async function test(id) {
  if (id === 'habitech') {
    if (!habitech.configured()) return { ok: false, message: 'No Habitech API key is set up.' };
    const status = await habitech.status({ fresh: true });
    if (status.error) return { ok: false, message: status.error };
    return { ok: true, message: `Connected. Habitech has prices for ${(status.count ?? 0).toLocaleString('en-GB')} products for us.` };
  }
  if (id === 'netxl') {
    if (!netxl.configured()) return { ok: false, message: 'No NetXL API key is set up.' };
    try {
      const who = await netxl.account();
      return { ok: true, message: `Connected to NetXL${who ? ` as ${who}` : ''}.` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }
  throw fail(404, `Unknown connection: ${id}`);
}

// "nightly": what the 5am job does (refresh anything more than ~20 hours old).
// "refresh-all": refresh every catalogue now. Both need RUN typed in the app.
async function runJob(body) {
  const job = body?.job;
  if (!['nightly', 'refresh-all'].includes(job)) throw fail(400, 'Unknown job');
  if (String(body?.confirm || '').trim().toUpperCase() !== 'RUN') throw fail(400, 'Type RUN to confirm.');
  const deadline = store.ON_VERCEL ? Date.now() + 50_000 : Infinity;
  const results = await catalogue.refreshStale(job === 'nightly' ? (20 / 24) * DAY : 0, { deadline });
  if (job === 'nightly') await saveNightly(results, 'Dev page');
  return { job, results };
}

async function saveNightly(results, trigger) {
  await store.saveCatalogue(NIGHTLY, { at: new Date().toISOString(), trigger, results }).catch((err) => {
    console.warn(`Could not save the nightly job's results: ${err.message}`);
  });
}

// Everything you'd need to rebuild the app's data: quotes with their saved
// versions and client activity, settings, kits, our product names and our
// own products. Catalogues aren't included (they're copied again from the
// suppliers). Download only; there's no restore button.
async function backup() {
  const quotes = await store.listQuotes();
  const ids = quotes.map((q) => q.id);
  const [settings, kits, productNames, customProducts, activity, revisions] = await Promise.all([
    store.getSettings(),
    store.getKits(),
    store.getProductNames(),
    store.getCustomProducts(),
    store.listActivity(ids),
    store.listRevisions(ids),
  ]);
  const byId = (list) => Object.fromEntries(ids.map((id, i) => [id, list[i] || null]));
  return {
    app: 'Mesh Quotes',
    exportedAt: new Date().toISOString(),
    version: pkg.version,
    commit: commit()?.sha || null,
    counts: { quotes: quotes.length, kits: kits.length },
    settings,
    quotes,
    revisions: byId(revisions),
    activity: byId(activity),
    kits,
    productNames,
    customProducts,
  };
}

module.exports = { info, test, runJob, saveNightly, backup };
