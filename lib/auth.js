// Team sign-in with one shared password.
//
// Set TEAM_PASSWORD (in Vercel: Settings → Environment Variables) and the
// quoting app asks for it. Proposal links (/p/...) stay open so clients can
// view their own proposal without signing in.
//
// Without TEAM_PASSWORD the app is open, which is only allowed when running on
// your own computer.

const crypto = require('crypto');

const COOKIE = 'mesh_session';
const MAX_AGE_S = 30 * 24 * 60 * 60;

function password() {
  return process.env.TEAM_PASSWORD || '';
}

function enabled() {
  return Boolean(password());
}

// Changing the password signs everyone out, because the key depends on it.
function key() {
  return crypto.createHash('sha256').update(`mesh-session:${process.env.SESSION_SECRET || ''}:${password()}`).digest();
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', key()).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSignedIn(req) {
  if (!enabled()) return true;
  return Boolean(verify(cookies(req)[COOKIE]));
}

function checkPassword(input) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(password()).digest();
  return crypto.timingSafeEqual(a, b);
}

function isHttps(req) {
  return req.headers['x-forwarded-proto'] === 'https' || Boolean(req.socket?.encrypted);
}

function signInCookie(req) {
  const token = sign({ exp: Date.now() + MAX_AGE_S * 1000 });
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${isHttps(req) ? '; Secure' : ''}`;
}

function signOutCookie(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isHttps(req) ? '; Secure' : ''}`;
}

// Slow down password guessing: a few failures per address, then a pause.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 8;

function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

function tooManyAttempts(req) {
  const entry = failures.get(clientAddress(req));
  return Boolean(entry && entry.count >= MAX_FAILURES && Date.now() - entry.first < WINDOW_MS);
}

function recordFailure(req) {
  const ip = clientAddress(req);
  const entry = failures.get(ip);
  if (!entry || Date.now() - entry.first > WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
  else entry.count += 1;
}

function clearFailures(req) {
  failures.delete(clientAddress(req));
}

module.exports = {
  enabled,
  isSignedIn,
  checkPassword,
  signInCookie,
  signOutCookie,
  tooManyAttempts,
  recordFailure,
  clearFailures,
};
