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
import { test, expect } from 'patchright/test';

import { parseJson, runCli } from '../fixtures';

const page = `data:text/html,<title>Short</title><p id="p">Hello <b>world</b></p><button id="b" onclick="setTimeout(()=>document.getElementById('p').hidden=true,500)">hide</button><div style="height:3000px"></div><a id="far">far</a>`;

test('url, title, text, wait, wait-for and scroll-to print just the value', async ({}) => {
  expect((await runCli(['open', page])).exitCode).toBe(0);
  expect((await runCli(['title'])).output).toBe('Short');
  expect((await runCli(['url'])).output).toMatch(/^data:text\/html,/);
  expect(parseJson(await runCli(['text', '#p', '--json']))).toEqual({ text: 'Hello world' });
  expect((await runCli(['text', '--max-chars=5'])).output).toBe('Hello');
  expect((await runCli(['wait', '100'])).output).toBe('Waited 100ms');

  expect((await runCli(['click', '#b'])).exitCode).toBe(0);
  expect((await runCli(['wait-for', '#p', '--state=hidden', '--timeout=5000'])).output).toBe('#p is hidden');
  const missing = await runCli(['wait-for', '#nope', '--timeout=300']);
  expect(missing.exitCode).toBe(1);
  expect(missing.error).toContain('Timeout 300ms exceeded');

  expect((await runCli(['scroll-to', '#far'])).output).toMatch(/^Scrolled #far into view at x=\d+ y=\d+/);
  expect((await runCli(['close'])).exitCode).toBe(0);
});

test('cookie-import reads a cookies.txt and cookie-export writes it back without printing values', async ({}) => {
  const input = test.info().outputPath('in.txt');
  fs.writeFileSync(input, '# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t2000000000\tsid\tsecret-value\n#HttpOnly_example.org\tFALSE\t/\tFALSE\t0\ttok\tother\n');
  expect((await runCli(['open', 'data:text/html,cookies'])).exitCode).toBe(0);

  const imported = await runCli(['cookie-import', input]);
  expect(imported.output).toContain('Imported 2 cookies');
  expect(imported.output).not.toContain('secret-value');

  const output = test.info().outputPath('out.txt');
  const exported = parseJson(await runCli(['cookie-export', output, '--format=netscape', '--domain=example.com', '--json']));
  expect(exported).toEqual({ file: output, count: 1, format: 'netscape' });
  expect(fs.readFileSync(output, 'utf8')).toMatch(/^\.example\.com\tTRUE\t\/\tTRUE\t\d+\tsid\tsecret-value$/m);
  expect((await runCli(['close'])).exitCode).toBe(0);
});
