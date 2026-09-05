#!/usr/bin/env node
// Silent consistency check for the start of a working session. Prints nothing when the
// checkout is coherent, so wiring it into an agent's session-start hook costs no context;
// it only speaks when something needs a human or an agent:
//   - patchright-core is not installed, or the installed version is not the pinned one;
//   - scripts/upstream-snapshot/versions.json disagrees with the pin (a roll was half done);
//   - lib/cli.js is missing or older than src/ (the built CLI would not reflect the code);
//   - once per new version: a newer patchright-core is on npm (checked at most once a day,
//     3 s budget, silently skipped offline).
//
//   node scripts/session-check.mjs [--verbose] [--no-network] [--root <dir>]

import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const noNetwork = argv.includes('--no-network') || !!process.env.PATCHRIGHT_CLI_SESSION_CHECK_OFFLINE;
const root = argv.includes('--root') ? path.resolve(argv[argv.indexOf('--root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function newestMtime(dir) {
  let newest = 0;
  const walk = d => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory())
        walk(full);
      else
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  };
  if (fs.existsSync(dir))
    walk(dir);
  return newest;
}

function semverGreater(a, b) {
  const pa = String(a).split(/[.-]/).map(Number);
  const pb = String(b).split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0))
      return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

function cacheFile() {
  const home = process.env.PATCHRIGHT_CLI_HOME
    || (process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'patchright-cli')
      : process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'patchright-cli')
        : path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'patchright-cli'));
  return path.join(home, 'session-check.json');
}

function latestOnNpm(name, timeoutMs) {
  return new Promise(resolve => {
    const request = https.get(`https://registry.npmjs.org/${name}/latest`, { headers: { accept: 'application/json' }, timeout: timeoutMs }, response => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try {
          resolve(JSON.parse(body).version);
        } catch {
          resolve(undefined);
        }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve(undefined); });
    request.on('error', () => resolve(undefined));
  });
}

async function main() {
  const lines = [];
  const pkg = readJson(path.join(root, 'package.json'));
  if (!pkg?.dependencies?.['patchright-core']) {
    console.log(`session-check: ${root} is not the patchright-cli checkout (no patchright-core pin in package.json)`);
    return;
  }
  const pinned = pkg.dependencies['patchright-core'];
  const installed = readJson(path.join(root, 'node_modules', 'patchright-core', 'package.json'));
  if (!installed)
    lines.push(`patchright-core is not installed (package.json pins ${pinned}): run npm ci`);
  else if (installed.version !== pinned)
    lines.push(`patchright-core ${installed.version} is installed but package.json pins ${pinned}: run npm ci`);

  const versions = readJson(path.join(root, 'scripts', 'upstream-snapshot', 'versions.json'));
  if (versions && versions.patchrightCore?.version !== pinned)
    lines.push(`scripts/upstream-snapshot/versions.json records patchright-core ${versions.patchrightCore?.version} but the pin is ${pinned}: an unfinished roll; run npm run roll -- --verify`);

  const built = path.join(root, 'lib', 'cli.js');
  if (!fs.existsSync(built))
    lines.push('lib/cli.js is not built: run npm run build');
  else if (fs.statSync(built).mtimeMs < newestMtime(path.join(root, 'src')))
    lines.push('lib/cli.js is older than src/: run npm run build before using bin/patchright-cli.js');

  let latest;
  if (!noNetwork) {
    const file = cacheFile();
    const cache = readJson(file) || {};
    const dayMs = 24 * 3600 * 1000;
    if (!cache.checkedAt || Date.now() - cache.checkedAt > dayMs) {
      latest = await latestOnNpm('patchright-core', 3000);
      if (latest) {
        cache.checkedAt = Date.now();
        cache.latest = latest;
      }
    } else {
      latest = cache.latest;
    }
    if (latest && semverGreater(latest, pinned) && cache.announced !== latest) {
      lines.push(`patchright-core ${latest} is on npm (pinned ${pinned}); preview the roll with: npm run roll -- --dry-run`);
      cache.announced = latest;
    }
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(cache));
    } catch {
      // a read-only cache dir is not a problem worth reporting
    }
  }

  if (lines.length)
    console.log(lines.map(line => `[patchright-cli] ${line}`).join('\n'));
  else if (verbose)
    console.log(`[patchright-cli] ok: patchright-core ${pinned} installed and recorded; lib/cli.js current${latest ? `; npm latest ${latest}` : ''}`);
}

main();
