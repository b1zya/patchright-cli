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

import { test, expect } from 'patchright/test';

import { parseConfigPrint, redactConfig } from '../../src/commands/configPrint';
import { writeState } from '../../src/humanize/state';
import { guardCommand, mainWorldEvalCode, scanRunCode, windowResizeCode } from '../../src/stealth/guards';
import { catalog } from '../../src/stealth/warnings';

import type { CommandContext } from '../../src/stealth';

function ctx(options: { headless?: boolean, initScript?: string[], secrets?: Record<string, string> } = {}): CommandContext {
  const entry = options.headless === undefined ? undefined : { config: { browser: { launchOptions: { headless: options.headless } } } };
  return {
    args: { _: [] },
    sessionName: 'default',
    clientInfo: { daemonProfilesDir: test.info().outputPath('daemon') } as any,
    registry: { entry: () => entry } as any,
    output: {} as any,
    userConfig: { ...(options.initScript ? { browser: { initScript: options.initScript } } : {}), ...(options.secrets ? { secrets: options.secrets } : {}) },
    runInSession: async () => '',
  };
}

test('humanize rewrites input commands when the session or the flag asks for it', () => {
  const context = ctx();
  // Off by default.
  expect(guardCommand('click', { _: ['click', 'e5'] }, context)).toEqual({ kind: 'allow' });
  // On for one command.
  const once = guardCommand('click', { _: ['click', 'e5'], humanize: true }, context);
  expect(once.kind).toBe('rewrite');
  if (once.kind !== 'rewrite')
    return;
  expect(once.args._[0]).toBe('run-code');
  expect(once.args._[1]).toContain('page.locator("aria-ref=e5")');
  expect(once.raw).toBe(true);
  expect(once.silent).toBe(true);
  expect(once.then).toEqual([{ _: ['snapshot'] }]);
  expect(keys(once)).toEqual(['humanize-limits']);
  // The warning is only shown once per session; the pointer position is remembered.
  once.onResult!(JSON.stringify({ cursor: { x: 12, y: 34 } }));
  const again = guardCommand('hover', { _: ['hover', '#x'], humanize: true }, context);
  expect(keys(again)).toEqual([]);
  if (again.kind === 'rewrite')
    expect(again.args._[1]).toContain('let cursor = {"x":12,"y":34};');
  // Session-level setting, with per-command opt-out.
  writeState(context.clientInfo.daemonProfilesDir, 'default', { humanize: true, humanizeWarned: true });
  expect(guardCommand('type', { _: ['type', 'hi'] }, context).kind).toBe('rewrite');
  expect(guardCommand('mousemove', { _: ['mousemove', '1', '2'] }, context)).toEqual(expect.objectContaining({ kind: 'rewrite', silent: false, then: [] }));
  expect(guardCommand('type', { _: ['type', 'hi'], humanize: false }, context)).toEqual({ kind: 'allow' });
  // Secrets are never typed literally.
  expect(guardCommand('fill', { _: ['fill', 'e1', 'PASSWORD'] }, ctx({ secrets: { PASSWORD: 'x' } })).kind).toBe('allow');
});

const keys = (result: { warnings?: { key: string }[] }) => (result.warnings ?? []).map(w => w.key);

test('run-code: refuses stealth-breaking code, warns about route-installing and emulation APIs', () => {
  expect(scanRunCode('async page => page.unrouteAll()', false).denied).toMatch(/unrouteAll/);
  expect(scanRunCode('async page => page.unrouteAll()', true).denied).toBeUndefined();
  expect(scanRunCode(`async page => { const c = await page.context().newCDPSession(page); await c.send('Runtime.enable'); }`, true).denied).toMatch(/Runtime\.enable/);
  expect(scanRunCode('async page => page.context().addInitScript(() => 1)', false)).toEqual({ warnings: [expect.objectContaining({ key: 'init-script-route' })] });
  expect(scanRunCode('async page => page.setViewportSize({ width: 1, height: 1 })', false).warnings.map(w => w.key)).toEqual(['run-code-emulation']);
  expect(scanRunCode('async page => page.title()', false)).toEqual({ warnings: [] });

  expect(guardCommand('run-code', { _: ['run-code', 'async page => page.unrouteAll()'] }, ctx())).toEqual({ kind: 'deny', message: expect.stringContaining('--force') });
  expect(guardCommand('run-code', { _: ['run-code', 'async page => page.unrouteAll()'], force: true }, ctx())).toEqual({ kind: 'allow', warnings: [] });
});

test('eval --main-world becomes a run-code snippet evaluating in the main world', () => {
  expect(guardCommand('eval', { _: ['eval', '() => 1'] }, ctx())).toEqual({ kind: 'allow' });
  const result = guardCommand('eval', { _: ['eval', '() => navigator.webdriver'], 'main-world': true }, ctx());
  expect(result.kind).toBe('rewrite');
  if (result.kind !== 'rewrite')
    return;
  expect(result.raw).toBe(true);
  expect(result.args._[0]).toBe('run-code');
  expect(result.args._[1]).toBe(mainWorldEvalCode('() => navigator.webdriver'));
  expect(result.args._[1]).toContain('page.evaluate(() => navigator.webdriver, undefined, undefined, false)');
  expect(keys(result)).toEqual(['main-world-eval']);

  expect(mainWorldEvalCode('el => el.id', 'e5')).toContain(`page.locator("aria-ref=e5").evaluate(el => el.id, undefined, undefined, false)`);
  expect(mainWorldEvalCode('el => el.id', '#login')).toContain(`page.locator("#login").evaluate(`);
  // Bare expressions are passed as strings so they evaluate in the page, not in the daemon.
  expect(mainWorldEvalCode('document.title')).toContain(`page.evaluate("document.title", undefined, undefined, false)`);
  expect(mainWorldEvalCode('JSON.stringify(window.__APP_STATE__)')).toContain(`page.evaluate("JSON.stringify(window.__APP_STATE__)", undefined, undefined, false)`);
  expect(mainWorldEvalCode('async () => await fetch("/x").then(r => r.status)')).toContain('page.evaluate(async () => await fetch(');
  expect(mainWorldEvalCode('function () { return 1 }')).toContain('page.evaluate(function () { return 1 }, undefined, undefined, false)');
  expect(guardCommand('eval', { _: ['eval'], 'main-world': true }, ctx())).toEqual({ kind: 'deny', message: expect.stringContaining('expression') });
});

test('resize moves the real window in headed sessions and warns otherwise', () => {
  const headed = guardCommand('resize', { _: ['resize', '1000', '700'] }, ctx({ headless: false }));
  expect(headed).toEqual({ kind: 'rewrite', args: { _: ['run-code', windowResizeCode(1000, 700)] }, raw: true });
  expect(windowResizeCode(1000, 700)).toContain(`Browser.setWindowBounds`);
  expect(guardCommand('resize', { _: ['resize', '1000', '700'] }, ctx({ headless: true }))).toEqual({ kind: 'allow', warnings: [expect.objectContaining({ key: 'viewport-emulation' })] });
  expect(guardCommand('resize', { _: ['resize', 'x', '700'] }, ctx({ headless: false })).kind).toBe('allow');
});

test('route, highlight, tracing and pdf policies', () => {
  expect(keys(guardCommand('route', { _: ['route', '**/api'] }, ctx()))).toEqual(['route-cache']);
  expect(keys(guardCommand('route', { _: ['route', '**/api'] }, ctx({ initScript: ['/x.js'] })))).toEqual(['route-cache', 'route-shadows-init']);
  expect(guardCommand('unroute', { _: ['unroute'] }, ctx())).toEqual({ kind: 'allow' });
  expect(keys(guardCommand('highlight', { _: ['highlight', 'e1'] }, ctx()))).toEqual(['highlight-dom']);
  expect(guardCommand('highlight', { _: ['highlight'], hide: true }, ctx())).toEqual({ kind: 'allow' });
  expect(keys(guardCommand('tracing-start', { _: ['tracing-start'] }, ctx()))).toEqual(['tracing']);
  expect(guardCommand('pdf', { _: ['pdf'] }, ctx({ headless: false })).kind).toBe('deny');
  expect(guardCommand('pdf', { _: ['pdf'] }, ctx({ headless: true }))).toEqual({ kind: 'allow' });
  expect(guardCommand('snapshot', { _: ['snapshot'] }, ctx())).toEqual({ kind: 'allow' });
});

test('git bash path conversion is detected and reported as a notice', () => {
  const mangled = guardCommand('find', { _: ['find'], regex: 'C:/Program Files/Git/sign (in|up)/i' }, ctx());
  expect(mangled.kind).toBe('allow');
  expect(mangled.warnings).toEqual([expect.objectContaining({ key: 'msys-path-conversion', kind: 'notice', message: expect.stringContaining('MSYS_NO_PATHCONV=1') })]);
  expect(guardCommand('click', { _: ['click', 'C:/Program Files/Git/html/body/button'] }, ctx()).warnings).toHaveLength(1);
  // Real files under those roots and normal arguments are left alone.
  expect(guardCommand('upload', { _: ['upload', 'C:/Program Files/Git/etc/notes.txt'] }, ctx())).toEqual({ kind: 'allow' });
  expect(guardCommand('find', { _: ['find'], regex: '[Ss]ign (in|up)' }, ctx())).toEqual({ kind: 'allow' });
  expect(guardCommand('goto', { _: ['goto', 'https://example.com/a=1&b=2'] }, ctx())).toEqual({ kind: 'allow' });
});

test('every warning has a severity and a message; only two are unsilenceable', () => {
  const unsilenceable = Object.entries(catalog).filter(([, entry]) => entry.unsilenceable).map(([key]) => key).sort();
  expect(unsilenceable).toEqual(['bundled-chromium', 'proxy-without-geoip']);
  for (const [key, entry] of Object.entries(catalog)) {
    expect(['HIGH', 'MEDIUM', 'LOW', 'INFO'], key).toContain(entry.severity);
    expect(entry.message.length, key).toBeGreaterThan(20);
  }
});

test('config-print output is parsed in both modes and proxy passwords are redacted', () => {
  const config = { browser: { launchOptions: { proxy: { server: 'http://p:1' } }, contextOptions: { proxy: { server: 'http://p:1', username: 'u', password: 'secret' } } } };
  expect(parseConfigPrint(`### Result\n${JSON.stringify(config)}`)).toEqual({ config, wrapped: false });
  expect(parseConfigPrint(JSON.stringify({ result: JSON.stringify(config) }))).toEqual({ config, wrapped: true });
  const redacted = redactConfig(config);
  expect(redacted.browser.contextOptions.proxy.password).toBe('***');
  expect(redacted.browser.launchOptions.proxy).toEqual({ server: 'http://p:1' });
  expect(config.browser.contextOptions.proxy.password).toBe('secret');
});
