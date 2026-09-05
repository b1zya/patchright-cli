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

import { contextProxy, describeProxy, launchProxy, parseProxy } from '../../src/stealth/proxy';

test('parses http, https, socks5 and schemeless proxies', () => {
  expect(parseProxy('http://proxy.example:3128')).toEqual({ protocol: 'http', server: 'http://proxy.example:3128', username: undefined, password: undefined, bypass: undefined });
  expect(parseProxy('https://proxy.example').server).toBe('https://proxy.example');
  expect(parseProxy('socks5://127.0.0.1:1080').protocol).toBe('socks5');
  expect(parseProxy('proxy.example:8080').server).toBe('http://proxy.example:8080');
  expect(parseProxy('http://[::1]:3128').server).toBe('http://[::1]:3128');
});

test('splits credentials out of the server url', () => {
  const proxy = parseProxy('http://us%40er:p%3Ass@proxy.example:3128', 'localhost,*.internal');
  expect(proxy).toEqual({ protocol: 'http', server: 'http://proxy.example:3128', username: 'us@er', password: 'p:ss', bypass: 'localhost,*.internal' });
  expect(launchProxy(proxy)).toEqual({ server: 'http://proxy.example:3128', bypass: 'localhost,*.internal' });
  expect(contextProxy(proxy)).toEqual({ server: 'http://proxy.example:3128', username: 'us@er', password: 'p:ss', bypass: 'localhost,*.internal' });
  expect(describeProxy(proxy)).toBe('http://us@er:***@proxy.example:3128');
});

test('rejects unsupported schemes, empty hosts and socks authentication', () => {
  expect(() => parseProxy('ftp://x:1')).toThrow(/Unsupported proxy scheme/);
  expect(() => parseProxy('')).toThrow(/empty/);
  expect(() => parseProxy('http://')).toThrow(/Invalid proxy URL|no host/);
  expect(() => parseProxy('socks5://user:pass@127.0.0.1:1080')).toThrow(/SOCKS proxy authentication/);
});
