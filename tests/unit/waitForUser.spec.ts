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

import { createWaitForUserCommand, displayProblem, parseSeconds, visibilityProblem, waitForNavigation } from '../../src/commands/waitForUser';
import type { CommandContext } from '../../src/stealth';

// A session whose `eval () => location.href` answers with the given URLs in turn (the last one repeats).
function fakeSession(urls: string[], options: { json?: boolean, seconds?: string } = {}) {
  const calls: string[][] = [];
  const results: string[] = [];
  let next = 0;
  const ctx = {
    args: { _: ['wait-for-user', ...(options.seconds ? [options.seconds] : [])] },
    sessionName: 'demo',
    clientInfo: { daemonProfilesDir: '/nowhere' },
    output: { json: options.json === true, toolResult: (text: string) => { results.push(text); } },
    async runInSession(args: { _: string[] }) {
      calls.push(args._);
      if (args._[0] === 'eval')
        return JSON.stringify(urls[Math.min(next++, urls.length - 1)]);
      if (args._[0] === 'snapshot')
        return '### Snapshot\n- heading "Dashboard"';
      throw new Error(`unexpected ${args._[0]}`);
    },
  } as unknown as CommandContext;
  return { ctx, calls, results };
}

const instant = async () => {};
const visible = { sleep: instant, isHeadless: () => false, displayProblem: () => undefined };

test('parses the timeout', () => {
  expect(parseSeconds(undefined)).toBe(300);
  expect(parseSeconds('45')).toBe(45);
  for (const bad of ['soon', '0', '-5'])
    expect(() => parseSeconds(bad), bad).toThrow(/positive number of seconds/);
});

test('returns as soon as the page navigates', async () => {
  const { ctx, calls } = fakeSession(['https://app.example/login', 'https://app.example/login', 'https://app.example/dashboard']);
  const slept: number[] = [];
  const result = await waitForNavigation(ctx, 300, async ms => { slept.push(ms); });
  expect(result).toEqual(expect.objectContaining({ navigated: true, startUrl: 'https://app.example/login', url: 'https://app.example/dashboard' }));
  expect(calls.filter(c => c[0] === 'eval')).toHaveLength(3);
  expect(slept).toEqual([2000, 2000]);
});

test('gives up at the deadline and reports the unchanged URL', async () => {
  const { ctx } = fakeSession(['https://app.example/login']);
  const result = await waitForNavigation(ctx, 0.05, instant);
  expect(result).toEqual({ navigated: false, url: 'https://app.example/login', startUrl: 'https://app.example/login', waitedSeconds: 0.05 });
});

test('refuses to hand over a window nobody can see', async () => {
  const { ctx, calls } = fakeSession(['https://app.example/login']);
  const headless = createWaitForUserCommand({ ...visible, isHeadless: () => true });
  await expect(headless.run(ctx)).rejects.toThrow(/headless: the user cannot see the window/);
  expect(calls).toEqual([]);
  expect(visibilityProblem(ctx, { isHeadless: () => false, displayProblem: () => 'no screen' })).toBe('no screen');
});

test('knows which Linux displays a person can look at', () => {
  expect(displayProblem('win32', {})).toBeUndefined();
  expect(displayProblem('darwin', {})).toBeUndefined();
  expect(displayProblem('linux', { DISPLAY: ':0' })).toBeUndefined();
  expect(displayProblem('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toBeUndefined();
  expect(displayProblem('linux', {})).toMatch(/No display/);
  expect(displayProblem('linux', { DISPLAY: ':99', XAUTHORITY: '/tmp/xvfb-run.k3Jd/Xauthority' })).toMatch(/xvfb/);
});

test('reports the outcome with a fresh snapshot, in text and JSON', async () => {
  const acted = fakeSession(['https://app.example/login', 'https://app.example/dashboard'], { seconds: '5' });
  await createWaitForUserCommand(visible).run(acted.ctx);
  expect(acted.results[0]).toMatch(/^### The user acted: page changed to https:\/\/app\.example\/dashboard/);
  expect(acted.results[0]).toContain('### Snapshot');
  expect(acted.calls[acted.calls.length - 1]).toEqual(['snapshot']);

  const idle = fakeSession(['https://app.example/login'], { seconds: '0.05', json: true });
  await createWaitForUserCommand(visible).run(idle.ctx);
  expect(JSON.parse(idle.results[0])).toEqual({ navigated: false, url: 'https://app.example/login', startUrl: 'https://app.example/login', waitedSeconds: 0.05, snapshot: '### Snapshot\n- heading "Dashboard"' });
});
