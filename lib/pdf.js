// Turns the proposal web page into a PDF using a Chromium browser that is
// already installed (Microsoft Edge on Windows, or Chrome/Chromium).
// No extra downloads needed. Set CHROME_PATH to point at a specific browser.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

function candidates() {
  const list = [];
  if (process.env.CHROME_PATH) list.push(process.env.CHROME_PATH);
  if (process.platform === 'win32') {
    const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter(Boolean);
    for (const root of roots) {
      list.push(path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      list.push(path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    list.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    list.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge');
  }
  return list;
}

let cached;
function findBrowser() {
  // Online hosts like Vercel have no browser; the proposal's print button is used instead.
  if (process.env.VERCEL || process.env.PDF_ENGINE === 'off') return undefined;
  if (cached !== undefined) return cached || undefined;
  cached = candidates().find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) || null;
  return cached || undefined;
}

function renderPdf(url, { timeoutMs = 60000 } = {}) {
  const browser = findBrowser();
  if (!browser) {
    return Promise.reject(
      Object.assign(new Error('No Edge or Chrome browser found to create the PDF. Use the Print button on the proposal page instead.'), { status: 501 }),
    );
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-pdf-'));
  const outFile = path.join(workDir, 'proposal.pdf');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--user-data-dir=${path.join(workDir, 'profile')}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=15000',
    `--print-to-pdf=${outFile}`,
    url,
  ];

  const deadline = Date.now() + timeoutMs;
  const cleanUp = () => fs.rm(workDir, { recursive: true, force: true }, () => {});

  // On Windows, Edge's launcher often exits at once and hands the work to
  // another process, so wait until the PDF has been written in full.
  function waitForPdf() {
    return new Promise((resolve, reject) => {
      let lastSize = -1;
      const check = () => {
        let size = -1;
        try {
          size = fs.statSync(outFile).size;
        } catch {}
        if (size > 0 && size === lastSize) return resolve(fs.readFileSync(outFile));
        lastSize = size;
        if (Date.now() > deadline) return reject(new Error('The browser did not produce a PDF'));
        setTimeout(check, 200);
      };
      check();
    });
  }

  return new Promise((resolve, reject) => {
    const child = spawn(browser, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => child.kill(), timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      cleanUp();
      reject(err);
    });
    child.on('exit', () => {
      clearTimeout(timer);
      waitForPdf()
        .then(resolve, reject)
        .finally(cleanUp);
    });
  });
}

module.exports = { renderPdf, findBrowser };
