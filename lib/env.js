// Reads private settings (such as the Habitech API key) from a `.env` file in
// the project folder when the app runs on your own computer. The file is
// never uploaded to GitHub. Online, the same settings live in Vercel →
// Settings → Environment Variables, and this file isn't used.
//
// Format: one NAME=value per line; lines starting with # are notes.
// Settings already present in the environment win over the file.

const fs = require('fs');
const path = require('path');

function loadEnv(file = path.join(__dirname, '..', '.env')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env file: nothing to do
  }
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const name = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !value) continue;
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

loadEnv();

module.exports = { loadEnv };
