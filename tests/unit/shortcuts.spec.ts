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

import { parseCookieFile, toNetscape } from '../../src/commands/cookies';
import { parseTimeout, scrollToCode, textCode, waitForCode, waitUrlCode } from '../../src/commands/pageShortcuts';

test('page shortcuts resolve refs through aria-ref and selectors as given', () => {
  expect(textCode(undefined, undefined)).toBe(`async page => (await page.locator('body').innerText())`);
  expect(textCode('e5', 100)).toBe(`async page => (await page.locator("aria-ref=e5").innerText()).slice(0, 100)`);
  expect(waitForCode('#p', 'hidden', 500)).toContain(`page.locator("#p").waitFor({ state: "hidden", timeout: 500 })`);
  expect(waitUrlCode('**/dash', 0)).toContain(`page.waitForURL("**/dash", { timeout: 0 })`);
  expect(scrollToCode('f1e2')).toContain(`const target = page.locator("aria-ref=f1e2"); await target.scrollIntoViewIfNeeded();`);
  expect(parseTimeout(undefined)).toBe(30000);
  expect(parseTimeout('0')).toBe(0);
  expect(() => parseTimeout('soon')).toThrow(/milliseconds/);
});

test('cookie files: browser-extension JSON, Netscape cookies.txt, storage state, Playwright array', () => {
  const extension = parseCookieFile(JSON.stringify([
    { domain: 'example.net', hostOnly: false, expirationDate: 2000000000.5, httpOnly: true, name: 'a', path: '/', sameSite: 'no_restriction', secure: true, session: false, value: '1' },
    { domain: 'shop.example.net', hostOnly: true, name: 'b', sameSite: 'unspecified', session: true, value: '2' },
  ]));
  expect(extension.format).toBe('browser extension JSON');
  expect(extension.cookies).toEqual([
    { name: 'a', value: '1', domain: '.example.net', path: '/', expires: 2000000000, httpOnly: true, secure: true, sameSite: 'None' },
    { name: 'b', value: '2', domain: 'shop.example.net', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' },
  ]);

  const netscape = parseCookieFile('# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t2000000000\tsid\tabc\n#HttpOnly_example.org\tFALSE\t/p\tFALSE\t0\ttok\tq=1\n');
  expect(netscape.format).toBe('Netscape cookies.txt');
  expect(netscape.cookies).toEqual([
    { name: 'sid', value: 'abc', domain: '.example.com', path: '/', expires: 2000000000, httpOnly: false, secure: true, sameSite: 'Lax' },
    { name: 'tok', value: 'q=1', domain: 'example.org', path: '/p', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' },
  ]);
  // Round trip through our own export.
  expect(parseCookieFile(toNetscape(netscape.cookies)).cookies).toEqual(netscape.cookies);

  const state = parseCookieFile(JSON.stringify({ cookies: [{ name: 'c', value: '3', domain: 'x.test', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Strict' }], origins: [] }));
  expect(state.format).toBe('Playwright storage state');
  expect(state.cookies[0].sameSite).toBe('Strict');

  expect(() => parseCookieFile('<html>')).toThrow(/cookies\.txt/);
  expect(() => parseCookieFile('{"origins": []}')).toThrow(/cookies/);
  expect(() => parseCookieFile('[{"value": "x"}]')).toThrow(/name and a domain/);
});
