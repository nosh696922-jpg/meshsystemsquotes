// Separate sign-ins: each person has their own name, email and password.
//
// Passwords are never stored. Each one is scrambled with scrypt and a random
// salt of its own, and only that is saved, so nobody (not even someone who can
// read the database) can see them. Signing in scrambles what was typed the
// same way and compares.
//
// Adding, changing and removing logins needs the owner key (TEAM_PASSWORD in
// Vercel), so only whoever holds it can let people in. See lib/auth.js.

const crypto = require('crypto');
const store = require('./store');

const MIN_PASSWORD = 10;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const CACHE_MS = 30 * 1000; // sign-in checks reuse the list this long

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function scramble(password, salt) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(String(password), Buffer.from(salt, 'base64'), KEY_LENGTH, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64');
  return { salt, hash: (await scramble(password, salt)).toString('base64') };
}

async function passwordMatches(user, password) {
  const given = await scramble(password, user.salt);
  const saved = Buffer.from(user.hash, 'base64');
  return given.length === saved.length && crypto.timingSafeEqual(given, saved);
}

const cleanEmail = (v) => String(v || '').trim().toLowerCase();
const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80);

function checkPassword(password) {
  if (String(password || '').length < MIN_PASSWORD) throw httpError(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  if (String(password).length > 200) throw httpError(400, 'That password is too long.');
}

// What the app may see about a login: never the scrambled password.
const publicView = (u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt, lastSignIn: u.lastSignIn || null });

// ---- The list (with a short cache for sign-in checks) ---------------------------

let cache = null; // { at, users }

async function all() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.users;
  const users = await store.getUsers();
  cache = { at: Date.now(), users };
  return users;
}

async function save(users) {
  await store.saveUsers(users);
  cache = { at: Date.now(), users };
}

async function fresh() {
  cache = null;
  return all();
}

async function list() {
  return (await fresh()).map(publicView);
}

async function count() {
  return (await all()).length;
}

// The login a session belongs to, if it still exists and its password hasn't
// changed since (changing it or removing the login signs them out).
async function forSession(id, ver) {
  const user = (await all()).find((u) => u.id === id);
  return user && user.ver === ver ? user : null;
}

// ---- Signing in -------------------------------------------------------------------

// Spent on unknown emails too, so a wrong email takes as long as a wrong password.
const DUMMY = { salt: crypto.randomBytes(16).toString('base64'), hash: crypto.randomBytes(KEY_LENGTH).toString('base64') };

async function signIn(email, password) {
  const users = await fresh();
  const user = users.find((u) => u.email === cleanEmail(email));
  const ok = await passwordMatches(user || DUMMY, password);
  if (!user || !ok) return null;
  user.lastSignIn = new Date().toISOString();
  await save(users).catch(() => {}); // only the "last signed in" date; not worth failing over
  return user;
}

// ---- Managing logins (owner key) --------------------------------------------------

async function add({ name, email, password }) {
  const users = await fresh();
  const clean = { name: cleanName(name), email: cleanEmail(email) };
  if (!clean.name) throw httpError(400, 'Give them a name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) throw httpError(400, 'That email address doesn’t look right.');
  if (users.some((u) => u.email === clean.email)) throw httpError(409, 'Someone already signs in with that email.');
  checkPassword(password);
  const user = { id: store.newId('u'), ...clean, ...(await hashPassword(password)), ver: 1, createdAt: new Date().toISOString(), lastSignIn: null };
  await save([...users, user]);
  return publicView(user);
}

// Change a login's name, email or password. A new password signs them out
// everywhere.
async function update(id, { name, email, password }) {
  const users = await fresh();
  const user = users.find((u) => u.id === id);
  if (!user) throw httpError(404, 'That login doesn’t exist any more.');
  if (name !== undefined) {
    if (!cleanName(name)) throw httpError(400, 'Give them a name.');
    user.name = cleanName(name);
  }
  if (email !== undefined) {
    const e = cleanEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw httpError(400, 'That email address doesn’t look right.');
    if (users.some((u) => u.id !== id && u.email === e)) throw httpError(409, 'Someone already signs in with that email.');
    user.email = e;
  }
  if (password !== undefined) {
    checkPassword(password);
    Object.assign(user, await hashPassword(password));
    user.ver = (user.ver || 1) + 1;
  }
  await save(users);
  return publicView(user);
}

async function remove(id) {
  const users = await fresh();
  if (!users.some((u) => u.id === id)) throw httpError(404, 'That login doesn’t exist any more.');
  await save(users.filter((u) => u.id !== id));
}

// Someone changing their own password: they have to know the current one.
async function changeOwn(id, current, next) {
  const user = (await fresh()).find((u) => u.id === id);
  if (!user || !(await passwordMatches(user, current))) throw httpError(400, 'Your current password isn’t right.');
  return update(id, { password: next });
}

module.exports = { list, count, forSession, signIn, add, update, remove, changeOwn, publicView, MIN_PASSWORD };
