/**
 * Copyright (c) 2026 b1zya (https://github.com/b1zya/patchright-cli).
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

// `selftest`: opens a throwaway session with the same launch profile a normal `open`
// would get, serves a local page and runs the detection corpus in the page main world.
// It drives the CLI itself as a child process so every layer (config, launch profile,
// guards) is exercised exactly as an agent would exercise it.

import { spawn } from 'child_process';
import http from 'http';

import { Registry } from '../registry';
import { readIdentity } from '../stealth/identity';
import { checksSource, selftestAsset, selftestFrame, selftestPage } from './selftestChecks';

import type { Check, InPageResult } from './selftestChecks';
import type { ClientCommand, CommandContext } from '../stealth';
import type { MinimistArgs } from '../args';

export const selftestSessionName = '__selftest';

// Groups whose failure means the session is detectable as automation.
export const criticalGroups = new Set(['automation', 'tamper', 'workers', 'geo']);

export const onlineDetectors = [
  { name: 'sannysoft', url: 'https://bot.sannysoft.com/', reading: 'every row green; "WebDriver (New)" false; Plugins 5' },
  { name: 'browserscan', url: 'https://www.browserscan.net/bot-detection', reading: 'verdict "Normal"; no WebDriver or CDP findings' },
  { name: 'creepjs', url: 'https://abrahamjuliot.github.io/creepjs/', reading: 'lies 0%, headless 0%, a stable fingerprint across reloads' },
  { name: 'fingerprint', url: 'https://fingerprint.com/products/bot-detection/', reading: '"You are not a bot"' },
  { name: 'iphey', url: 'https://iphey.com/', reading: '"trustworthy"; IP, timezone and language rows consistent' },
  { name: 'pixelscan', url: 'https://pixelscan.net/', reading: '"consistent"; no automation framework detected' },
  { name: 'brotector', url: 'https://kaliiiiiiiiii.github.io/brotector/', reading: 'only the CDP input-event rows are expected to trigger (OS-level input is out of scope)' },
];

export type SelftestReport = {
  session: string;
  env?: InPageResult['env'];
  checks: Check[];
  summary: { passed: number, failed: number, info: number, skipped: number, criticalFailures: number };
  online?: { name: string, url: string, screenshot?: string, reading: string, error?: string, reopened?: boolean }[];
};

type Invoked = { output: string, error: string, exitCode: number | null };

function invokeSelf(args: string[]): Promise<Invoked> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], `-s=${selftestSessionName}`, ...args], {
      env: process.env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let error = '';
    child.stdout.on('data', data => output += data.toString());
    child.stderr.on('data', data => error += data.toString());
    child.on('error', reject);
    child.on('close', exitCode => resolve({ output: output.trim(), error: error.trim(), exitCode }));
  });
}

// Close every tab except the first (the local anchor page), so a detector that spawned tabs
// does not leave stray indices for the next one. Best-effort: stops when only one tab is left.
async function closeExtraTabs(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const list = await invokeSelf(['tab-list']);
    const indices = [...list.output.matchAll(/^\s*-\s*(\d+):/gm)].map(m => Number(m[1]));
    if (list.exitCode !== 0 || indices.length <= 1)
      return;
    const highest = Math.max(...indices);
    if ((await invokeSelf([`tab-close`, String(highest)])).exitCode !== 0)
      return;
  }
}

async function startPageServer(): Promise<{ server: http.Server, baseUrl: string }> {
  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/asset.js')) {
      res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'max-age=3600' });
      res.end(selftestAsset);
    } else if (url.startsWith('/frame')) {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(selftestFrame);
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(selftestPage);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

const passthroughFlags = ['headless', 'headed', 'isolated', 'proxy', 'proxy-bypass', 'geoip', 'locale', 'timezone', 'browser'];

export function openArgsFrom(args: MinimistArgs): string[] {
  const result: string[] = [];
  for (const flag of passthroughFlags) {
    const value = args[flag];
    if (value === undefined)
      continue;
    if (value === true)
      result.push(`--${flag}`);
    else if (value === false)
      result.push(`--no-${flag}`);
    else
      for (const item of Array.isArray(value) ? value : [value])
        result.push(`--${flag}=${item}`);
  }
  // selftest measures the anti-detection posture of the real stealth profile, which is the
  // headed one; the global `open` default is headless, so ask for headed explicitly unless
  // the user is deliberately checking headless. On a displayless host this surfaces the
  // headed-without-display error (run under xvfb-run, or `selftest --headless`).
  if (args.headless === undefined && args.headed === undefined)
    result.push('--headed');
  return result;
}

export function inPageCode(): string {
  return [
    'async page => {',
    `  const main = await page.evaluate(${checksSource}, undefined, undefined, false);`,
    '  await page.reload();',
    `  const cache = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.endsWith('/asset.js')).map(e => e.transferSize), undefined, undefined, false);`,
    '  return { main, cache };',
    '}',
  ].join('\n');
}

export function summarize(checks: Check[]): SelftestReport['summary'] {
  const count = (status: Check['status']) => checks.filter(c => c.status === status).length;
  return {
    passed: count('PASS'),
    failed: count('FAIL'),
    info: count('INFO'),
    skipped: count('SKIP'),
    criticalFailures: checks.filter(c => c.status === 'FAIL' && criticalGroups.has(c.group)).length,
  };
}

export function renderReport(report: SelftestReport): string {
  const lines = [`### selftest (session ${report.session})`];
  if (report.env)
    lines.push(`- ${report.env.userAgent}`, `- ${report.env.platform}, ${report.env.language} [${report.env.languages.join(',')}], ${report.env.timezone}, ${report.env.hardwareConcurrency} cores`, '');
  for (const check of report.checks)
    lines.push(`[${check.status.padEnd(4)}] ${check.group}/${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  const s = report.summary;
  lines.push('', `${s.passed} passed, ${s.failed} failed (${s.criticalFailures} critical), ${s.info} info, ${s.skipped} skipped`);
  if (report.online?.length) {
    lines.push('', '### Online detectors (read the screenshots; nothing is scraped)');
    for (const site of report.online)
      lines.push(`- ${site.name}: ${site.url}${site.screenshot ? ` -> ${site.screenshot}` : ''}${site.error ? ` (error: ${site.error})` : ''}`, `  expected: ${site.reading}`);
  }
  return lines.join('\n');
}

async function runSelftest(ctx: CommandContext): Promise<SelftestReport> {
  const { server, baseUrl } = await startPageServer();
  const checks: Check[] = [];
  let env: InPageResult['env'] | undefined;
  let online: SelftestReport['online'];
  try {
    const opened = await invokeSelf(['open', `${baseUrl}/`, ...openArgsFrom(ctx.args)]);
    if (opened.error && !ctx.output.json)
      process.stderr.write(opened.error + '\n');
    if (opened.exitCode !== 0)
      throw new Error(`selftest could not open the browser:\n${opened.error || opened.output}`);

    const ran = await invokeSelf(['run-code', '--raw', inPageCode()]);
    if (ran.exitCode !== 0)
      throw new Error(`selftest checks failed to run:\n${ran.error || ran.output}`);
    const result = JSON.parse(ran.output) as { main: InPageResult, cache: number[] };
    env = result.main.env;
    checks.push(...result.main.checks);
    checks.push({
      group: 'cache',
      name: 'assets are served from cache on reload',
      status: result.cache.length ? (result.cache.some(size => size === 0) ? 'PASS' : 'FAIL') : 'SKIP',
      detail: result.cache.length ? `transferSize ${result.cache.join(',')}` : 'asset entry not found',
    });

    // Geo coherence against the identity the launch profile wrote.
    const registry = await Registry.load();
    const entry = registry.entry(ctx.clientInfo, selftestSessionName);
    const identity = entry?.config.browser?.userDataDir ? readIdentity(entry.config.browser.userDataDir) : undefined;
    if (identity?.timezone)
      checks.push({ group: 'geo', name: 'browser timezone matches the identity', status: env.timezone === identity.timezone ? 'PASS' : 'FAIL', detail: `${env.timezone} vs ${identity.timezone}` });
    if (identity?.locale)
      checks.push({ group: 'geo', name: 'browser language matches the identity', status: env.language.split('-')[0] === identity.locale.split('-')[0] ? 'PASS' : 'FAIL', detail: `${env.language} vs ${identity.locale}` });
    if (!identity?.timezone && !identity?.locale)
      checks.push({ group: 'geo', name: 'timezone and language coherence with the exit IP', status: 'SKIP', detail: 'no proxy/geoip for this session' });

    if (ctx.args.online) {
      online = [];
      // Each detector gets its own tab while the local page stays open as an anchor: a site
      // that closes or crashes its tab then costs one screenshot, not the whole session (with
      // a single tab the context closes and the daemon exits). Detector pages scroll to their
      // results, so scroll back to the top, where the verdict is, before the screenshot.
      for (const detector of onlineDetectors) {
        const site: NonNullable<SelftestReport['online']>[number] = { ...detector };
        try {
          // A hostile page can take the whole browser down (the daemon exits with it); reopen
          // the session so one site costs one screenshot and not the rest of the tour.
          if ((await invokeSelf(['tab-list'])).exitCode !== 0) {
            const reopened = await invokeSelf(['open', `${baseUrl}/`, ...openArgsFrom(ctx.args)]);
            if (reopened.exitCode !== 0)
              throw new Error(`the browser went down after the previous site and could not be reopened:\n${reopened.error || reopened.output}`);
            site.reopened = true;
          }
          const navigated = await invokeSelf(['tab-new', detector.url]);
          if (navigated.exitCode !== 0)
            throw new Error(navigated.error || navigated.output);
          // Give the page time to settle, then bring its own results to the top of the viewport.
          await invokeSelf(['run-code', '--raw', 'async page => { await page.waitForTimeout(8000); await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {}); await page.waitForTimeout(500); }']);
          const filename = `selftest-${detector.name}.png`;
          const shot = await invokeSelf(['screenshot', `--filename=${filename}`, '--raw']);
          if (shot.exitCode !== 0)
            throw new Error(shot.error || shot.output);
          site.screenshot = filename;
        } catch (e: any) {
          site.error = e.message;
        }
        // Leave only the anchor tab: some detectors open extra tabs, whose stray indices would
        // otherwise derail the next detector. Do it whether the screenshot worked or not.
        await closeExtraTabs();
        online.push(site);
      }
    }
  } finally {
    await invokeSelf(['close']).catch(() => {});
    server.close();
  }
  return { session: selftestSessionName, env, checks, summary: summarize(checks), online };
}

export const selftestCommand: ClientCommand = {
  name: 'selftest',
  async run(ctx) {
    const report = await runSelftest(ctx);
    ctx.output.toolResult(ctx.output.json ? JSON.stringify(report, null, 2) : renderReport(report));
    if (report.summary.criticalFailures > 0)
      process.exitCode = 1;
  },
};
