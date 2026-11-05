// Mesh quoting tool — run it on your own computer.
//
//   npm start             this computer only (http://localhost:3000)
//   npm run start:shared  others on the same network can open it too
//
// Online it runs on Vercel instead (see api/index.js and README.md).
// No external packages needed; just Node.js 18 or newer.

const http = require('http');
const os = require('os');

const { handle } = require('./lib/app');
const store = require('./lib/store');
const catalogue = require('./lib/catalogue');
const auth = require('./lib/auth');

const PORT = Number(process.env.PORT) || 3000;
const SHARED = process.argv.includes('--shared') || process.env.HOST === '0.0.0.0';
const HOST = SHARED ? '0.0.0.0' : process.env.HOST || '127.0.0.1';

const server = http.createServer(handle);

server.listen(PORT, HOST, () => {
  const info = store.info();
  console.log('');
  console.log('  Mesh quoting tool is running');
  console.log(`  Open:  http://localhost:${PORT}`);
  if (SHARED) {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  On your network: http://${a.address}:${PORT}`);
      }
    }
  }
  console.log(`  Data:  ${info.name === 'files' ? info.location : `${info.name} (${info.location})`}`);
  console.log(`  Sign-in: ${auth.enabled() ? 'team password required' : 'off (set TEAM_PASSWORD to turn it on)'}`);
  console.log('');

  const refresh = () => catalogue.refreshStale().catch((err) => console.error(`[catalogue] ${err.message}`));
  refresh();
  setInterval(refresh, 60 * 60 * 1000).unref();
});
