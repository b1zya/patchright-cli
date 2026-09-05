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

import { parseBatchScript, splitCommandLine } from '../../src/commands/batch';

test('splits command lines like a shell would', () => {
  expect(splitCommandLine('open https://example.com/?a=1&b=2')).toEqual(['open', 'https://example.com/?a=1&b=2']);
  expect(splitCommandLine('fill e5 "user@example.com" --submit')).toEqual(['fill', 'e5', 'user@example.com', '--submit']);
  expect(splitCommandLine(`eval --main-world '() => document.title'`)).toEqual(['eval', '--main-world', '() => document.title']);
  expect(splitCommandLine('run-code "async page => page.evaluate(\\"1+1\\")"')).toEqual(['run-code', 'async page => page.evaluate("1+1")']);
  expect(splitCommandLine('snapshot   # trailing comment')).toEqual(['snapshot']);
  expect(splitCommandLine('find "#main" --regex "a#b"')).toEqual(['find', '#main', '--regex', 'a#b']);
  expect(() => splitCommandLine('type "unterminated')).toThrow(/Unterminated quote/);
});

test('parses a script: comments, blank lines and a leading binary name are tolerated', () => {
  const steps = parseBatchScript([
    '# login flow',
    '',
    'patchright-cli -s=acme open https://acme.example/login',
    'fill e1 "user@example.com"',
    '  fill e2 "hunter2" --submit  ',
    'close',
  ].join('\n'));
  expect(steps.map(s => s.args)).toEqual([
    ['-s=acme', 'open', 'https://acme.example/login'],
    ['fill', 'e1', 'user@example.com'],
    ['fill', 'e2', 'hunter2', '--submit'],
    ['close'],
  ]);
  expect(steps.map(s => s.line)).toEqual([3, 4, 5, 6]);
  expect(parseBatchScript('# only comments\n\n')).toEqual([]);
});
