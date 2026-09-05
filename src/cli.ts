/**
 * Copyright (c) Microsoft Corporation.
 * Modifications for patchright-cli (https://github.com/b1zya/patchright-cli).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Entry point: a once-a-day update / skill-drift check, then the CLI program.

import fs from 'fs';
import https from 'https';
import path from 'path';

import { packageJSON } from './core';
import { watchdogMarker } from './killAll';
import { env, updateCheckFile } from './paths';
import { program } from './program';
import { checkInstalledSkills, frame } from './skillCheck';
import { compareSemver } from './socketConnection';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RELEASES_URL = 'https://api.github.com/repos/b1zya/patchright-cli/releases/latest';

main().catch(e => {
  /* eslint-disable no-console */
  console.error(e.message);
  /* eslint-disable no-restricted-properties */
  process.exit(1);
});

async function main() {
  // The session watchdog (src/lifetime.ts) is a background process; no update check for it.
  if (process.argv[2] !== watchdogMarker)
    await checkForUpdates().catch(() => {});
  await program({ embedderVersion: packageJSON.version });
}

async function checkForUpdates() {
  if (process.env.NO_UPDATE_NOTIFIER || process.env.CI)
    return;

  const cache = readCache();
  const stale = !cache || (Date.now() - cache.lastCheck) > ONE_DAY_MS;
  if (!stale)
    return;
  writeCache({ lastCheck: Date.now() });

  const command = process.argv.slice(2).find(arg => !arg.startsWith('-'));
  if (command !== 'install')
    checkInstalledSkills();

  const latest = await fetchLatestVersion();
  if (latest && compareSemver(latest, packageJSON.version) > 0)
    printNotice(packageJSON.version, latest);
}

// Uses https.request with agent: false instead of fetch(): undici keeps a pooled keep-alive
// socket that races with process.exit() in program() and trips a libuv assertion on Windows.
function fetchLatestVersion(): Promise<string | undefined> {
  const url = process.env[env.updateUrlForTest] || RELEASES_URL;
  return new Promise(resolve => {
    const req = https.request(url, {
      agent: false,
      timeout: 1500,
      headers: { 'User-Agent': `${packageJSON.name}/${packageJSON.version}`, 'Accept': 'application/vnd.github+json' },
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(undefined);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const tag = typeof json.tag_name === 'string' ? json.tag_name : undefined;
          const version = tag?.replace(/^v/, '');
          resolve(version && /^\d+\.\d+\.\d+/.test(version) ? version : undefined);
        } catch {
          resolve(undefined);
        }
      });
      res.on('error', () => resolve(undefined));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(undefined));
    req.end();
  });
}

function printNotice(current: string, latest: string) {
  process.stderr.write('\n' + frame([
    `Update available for ${packageJSON.name}: ${current} → ${latest}`,
    `Run \`npm install -g github:b1zya/patchright-cli#v${latest}\` to update.`,
  ]) + '\n');
}

function cacheFile(): string {
  return updateCheckFile();
}

function readCache(): { lastCheck: number } | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    if (typeof data.lastCheck === 'number')
      return data;
  } catch {
  }
  return undefined;
}

function writeCache(data: { lastCheck: number }) {
  const file = cacheFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch {
  }
}
