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

import fs from 'fs';
import http from 'http';
import path from 'path';
import { test, expect } from 'patchright/test';

import { homeDir, parseJson, runCli } from '../fixtures';

// Every test opens its own headed Chrome; keep them serial to avoid fighting over the display.
test.describe.configure({ mode: 'serial' });

async function mainWorld(expression: string, env: Record<string, string> = {}): Promise<any> {
  const result = await runCli(['eval', '--main-world', '--raw', expression], env);
  expect(result.exitCode, result.error || result.output).toBe(0);
  return JSON.parse(result.output);
}

async function resolvedConfig(): Promise<any> {
  return JSON.parse(parseJson(await runCli(['config-print', '--json'])).result);
}

test('--headed open: real Chrome, headed, persistent, no automation markers', async ({}) => {
  // Headed is opt-in now; this test asserts the anti-detection posture of the headed profile.
  const opened = await runCli(['open', 'data:text/html,<title>stealth</title>hello', '--headed', '--json']);
  expect(opened.exitCode, opened.error).toBe(0);
  expect(parseJson(opened).warnings).toBeUndefined();

  const config = await resolvedConfig();
  expect(['chrome', 'msedge']).toContain(config.browser.launchOptions.channel);
  expect(config.browser.launchOptions.headless).toBe(false);
  expect(config.browser.isolated).toBe(false);
  expect(config.browser.launchOptions.args).toContain('--start-maximized');
  expect(config.browser.launchOptions.args).toContain('--test-type='); // no "unsupported command-line flag" infobar
  expect(config.browser.launchOptions.args).not.toContain('--no-sandbox');
  expect(config.browser.contextOptions.viewport).toBeNull();
  expect(config.browser.contextOptions.colorScheme).toBe('no-override');
  expect(config.browser.userDataDir).toContain(path.join(homeDir(), 'daemon'));

  expect(await mainWorld('() => navigator.webdriver')).toBe(false);
  expect(await mainWorld('() => Object.getOwnPropertyNames(window).filter(k => /^(__pw|__playwright|__puppeteer|cdc_|\\$cdc_|__webdriver|_selenium)/i.test(k))')).toEqual([]);
  expect(await mainWorld('() => typeof window.chrome')).toBe('object');
  expect(await mainWorld('() => navigator.userAgent')).not.toMatch(/Headless/);
  expect(await mainWorld('() => window.outerWidth > 0 && window.outerHeight > 0')).toBe(true);
  // Page globals are visible in the main world and invisible in the isolated one.
  expect(await mainWorld('() => { window.__appMarker = 42; return window.__appMarker; }')).toBe(42);
  const isolated = await runCli(['eval', '--raw', '() => typeof window.__appMarker']);
  expect(isolated.output).toBe('"undefined"');
  // Bare expressions work in the main world too (they evaluate in the page, not in the daemon).
  expect(await mainWorld('window.__appMarker + 1')).toBe(43);
  expect(await mainWorld('document.title')).toBe('stealth');

  // The persistent profile carries an identity.
  const identity = parseJson(await runCli(['identity', '--json']));
  expect(identity.identity).toEqual(expect.objectContaining({ version: 1, channel: config.browser.launchOptions.channel }));
  expect(fs.existsSync(path.join(identity.profile, 'patchright-cli.json'))).toBe(true);

  expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});

test('guards: run-code scan, console explanation, resize of the real window, redacted config', async ({}) => {
  // Resize moves the real window, which only applies to a headed session.
  expect(await runCli(['open', 'data:text/html,guards', '--headed'])).toEqual(expect.objectContaining({ exitCode: 0 }));

  const denied = await runCli(['run-code', 'async page => page.unrouteAll()']);
  expect(denied.exitCode).toBe(1);
  expect(denied.error).toContain('unrouteAll');

  const consoleResult = await runCli(['console', '--json']);
  expect(consoleResult.exitCode).toBe(0);
  const consolePayload = parseJson(consoleResult);
  expect(consolePayload.warnings).toEqual([expect.objectContaining({ key: 'console-unavailable' })]);
  expect(JSON.stringify(consolePayload)).toContain('not available');

  const resized = await runCli(['resize', '1000', '700', '--json']);
  expect(resized.exitCode, resized.error).toBe(0);
  expect(await mainWorld('() => window.outerWidth')).toBe(1000);
  expect(JSON.parse((await runCli(['run-code', '--raw', 'async page => page.viewportSize()'])).output)).toBeNull();

  expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});

test('opting out is allowed but warned about', async ({}) => {
  // Plain headless is the default and is quiet apart from one note: it only warns in an
  // anti-detection context (a proxy). The note says which user agent it presents: headless
  // Chrome calls itself HeadlessChrome, the session shows the headed name of the same build,
  // in the page, in workers and in request headers, with the real client-hint versions.
  // Client hints (navigator.userAgentData) exist only in a secure context, so serve a page
  // on the loopback address instead of a data: URL.
  const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>headless</title>hello'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const headless = await runCli(['open', `http://127.0.0.1:${(server.address() as any).port}/`, '--headless', '--isolated', '--json']);
  expect(headless.exitCode, headless.error).toBe(0);
  expect(parseJson(headless).warnings).toEqual([expect.objectContaining({ key: 'headless-user-agent', kind: 'notice' })]);
  expect((await resolvedConfig()).browser.launchOptions.headless).toBe(true);
  const presented = await mainWorld(`async () => {
    const worker = new Worker(URL.createObjectURL(new Blob(['postMessage(navigator.userAgent)'])));
    const workerUa = await new Promise(resolve => { worker.onmessage = e => resolve(e.data); });
    const hints = await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'uaFullVersion']);
    return { ua: navigator.userAgent, workerUa, brands: navigator.userAgentData.brands.map(b => b.brand), full: hints.uaFullVersion, list: hints.fullVersionList.length };
  }`);
  expect(presented.ua).toMatch(/ Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
  expect(presented.ua).not.toContain('Headless');
  expect(presented.workerUa).toBe(presented.ua);
  expect(presented.brands.join()).not.toContain('Headless');
  expect(presented.full.split('.')[0]).toBe(presented.ua.match(/Chrome\/(\d+)/)![1]);
  expect(presented.list).toBeGreaterThan(0);
  expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
  server.close();
  // Opting out keeps Chrome's own headless name.
  const raw = await runCli(['open', 'data:text/html,raw', '--headless', '--no-headless-user-agent', '--isolated', '--json']);
  expect(raw.exitCode, raw.error).toBe(0);
  expect(parseJson(raw).warnings).toBeUndefined();
  expect(await mainWorld('navigator.userAgent')).toContain('HeadlessChrome/');
  expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));

  const firefox = await runCli(['open', 'data:text/html,x', '--browser=firefox']);
  expect(firefox.exitCode).toBe(1);
  expect(firefox.error).toContain('not supported');

  const quiet = await runCli(['open', 'data:text/html,quiet', '--proxy=http://127.0.0.1:9', '--no-geoip', '--isolated', '--json'], { PATCHRIGHT_CLI_QUIET_WARNINGS: '1' });
  // A dead proxy still lets Chrome start; the unsilenceable warning must be there regardless.
  expect(parseJson(quiet).warnings).toEqual([expect.objectContaining({ key: 'proxy-without-geoip', unsilenceable: true })]);
  await runCli(['close']);
});

test('geoip drives timezone and language coherently', async ({}) => {
  const server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ip: '1.2.3.4', country: 'DE', timezone: 'Europe/Berlin', loc: '52.52,13.405' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { PATCHRIGHT_CLI_GEOIP_URL: `http://127.0.0.1:${(server.address() as any).port}/json` };
  try {
    const opened = await runCli(['open', 'data:text/html,geo', '--geoip', '--json'], env);
    expect(opened.exitCode, opened.error).toBe(0);
    expect(await mainWorld('() => Intl.DateTimeFormat().resolvedOptions().timeZone')).toBe('Europe/Berlin');
    expect(await mainWorld('() => navigator.language')).toMatch(/^de/);
    if (process.platform !== 'darwin')
      expect(await mainWorld('() => navigator.languages.length')).toBeGreaterThanOrEqual(2);
    // Workers must agree with the main thread.
    const workerTz = await mainWorld(`() => new Promise(resolve => { const w = new Worker(URL.createObjectURL(new Blob(['postMessage(Intl.DateTimeFormat().resolvedOptions().timeZone)']))); w.onmessage = e => resolve(e.data); })`);
    expect(workerTz).toBe('Europe/Berlin');
    const identity = parseJson(await runCli(['identity', '--json'], env)).identity;
    expect(identity).toEqual(expect.objectContaining({ locale: 'de-DE', timezone: 'Europe/Berlin', geo: expect.objectContaining({ countryCode: 'DE' }) }));
    expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
  } finally {
    server.close();
  }
});

test('humanize moves the pointer along a path and types with cadence', async ({}) => {
  const page = 'data:text/html,<button id="b" onclick="window.__clicked=(window.__clicked||0)+1">go</button><input id="i">'
    + '<script>window.__moves=[];addEventListener("mousemove",e=>window.__moves.push([e.clientX,e.clientY]));'
    + 'document.getElementById("i").addEventListener("input",()=>{window.__inputs=(window.__inputs||0)+1})</script>';
  const opened = await runCli(['open', page, '--humanize', '--isolated', '--json']);
  expect(opened.exitCode, opened.error).toBe(0);

  const click = await runCli(['click', '#b', '--json']);
  expect(click.exitCode, click.error).toBe(0);
  expect(parseJson(click).warnings).toEqual([expect.objectContaining({ key: 'humanize-limits' })]);
  const moves = await mainWorld('() => window.__moves.length');
  expect(moves).toBeGreaterThanOrEqual(3);
  expect(await mainWorld('() => window.__clicked')).toBe(1);

  // The next action starts from where the last one ended, and the warning is not repeated.
  const fill = await runCli(['fill', '#i', 'hi there', '--json']);
  expect(fill.exitCode, fill.error).toBe(0);
  expect(parseJson(fill).warnings).toBeUndefined();
  expect(await mainWorld('() => document.getElementById("i").value')).toBe('hi there');
  expect(await mainWorld('() => window.__inputs')).toBe(8);
  const path = await mainWorld('() => window.__moves');
  expect(path.length).toBeGreaterThan(moves);

  // Per-command opt-out uses the daemon's instant tool.
  const instant = await runCli(['click', '#b', '--no-humanize']);
  expect(instant.exitCode, instant.error).toBe(0);
  expect(await mainWorld('() => window.__clicked')).toBe(2);

  expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});

test('selftest passes on a default launch', async ({}) => {
  const result = await runCli(['selftest', '--json']);
  expect(result.exitCode, result.error || result.output).toBe(0);
  const report = parseJson(result);
  expect(report.session).toBe('__selftest');
  expect(report.checks.length).toBeGreaterThan(25);
  const failed = report.checks.filter((c: any) => c.status === 'FAIL');
  expect(failed.filter((c: any) => ['automation', 'tamper', 'workers', 'geo'].includes(c.group)), JSON.stringify(failed)).toEqual([]);
  expect(report.summary.criticalFailures).toBe(0);
  expect(report.checks).toEqual(expect.arrayContaining([
    expect.objectContaining({ group: 'automation', name: 'navigator.webdriver is not true', status: 'PASS' }),
    expect.objectContaining({ group: 'automation', name: 'console serialization does not read Error.stack', status: 'PASS' }),
    expect.objectContaining({ group: 'workers', name: 'worker timezone matches', status: 'PASS' }),
    expect.objectContaining({ group: 'cache', status: 'PASS' }),
  ]));
  // The throwaway session is gone afterwards.
  expect((await runCli(['list'])).output).not.toContain('__selftest');
});

test('doctor reports browsers and stray configuration', async ({}) => {
  fs.mkdirSync(path.join(test.info().outputPath(), '.playwright'), { recursive: true });
  fs.writeFileSync(path.join(test.info().outputPath(), '.playwright', 'cli.config.json'), '{}');
  const result = await runCli(['doctor', '--json'], { PLAYWRIGHT_MCP_HEADLESS: '1' });
  const report = parseJson(result);
  expect(report.core.name).toBe('patchright-core');
  expect(report.browsers.some((b: any) => b.executablePath)).toBe(true);
  expect(report.issues).toEqual(expect.arrayContaining([
    expect.stringContaining('cli.config.json'),
    expect.stringContaining('PLAYWRIGHT_MCP_HEADLESS'),
  ]));
  expect(result.exitCode).toBe(1);
});
