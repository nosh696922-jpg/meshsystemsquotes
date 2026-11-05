// Vercel entry point. vercel.json sends /api/* and /p/* here; everything in
// public/ is served directly as static files.

const { handle } = require('../lib/app');

module.exports = (req, res) => handle(req, res);
