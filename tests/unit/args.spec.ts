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

import { test, expect } from 'patchright/test';

import { minimist } from '../../src/args';

test('parses positionals, --key=value and boolean flags', () => {
  const args = minimist(['click', 'e5', '--button=right', '--json'], { boolean: ['json'], string: ['_'] });
  expect(args).toEqual({ _: ['click', 'e5'], button: 'right', json: true });
});

test('keeps -s=name as a short alias value', () => {
  const args = minimist(['-s=todo', 'snapshot'], { string: ['_'] });
  expect(args).toEqual({ _: ['snapshot'], s: 'todo' });
});

test('treats the next token as a value for non-boolean flags', () => {
  const args = minimist(['open', '--browser', 'chrome', '--headed'], { boolean: ['headed'], string: ['_'] });
  expect(args).toEqual({ _: ['open'], browser: 'chrome', headed: true });
});

test('supports --no-flag and everything after --', () => {
  const args = minimist(['type', '--no-submit', '--', '--literal'], { boolean: ['submit'], string: ['_'] });
  expect(args).toEqual({ _: ['type', '--literal'], submit: false });
});

test('rejects =value on boolean flags', () => {
  expect(() => minimist(['--headed=true'], { boolean: ['headed'] })).toThrow(/boolean option '--headed'/);
});

test('collects repeated flags into an array', () => {
  const args = minimist(['upload', '--path=a.txt', '--path=b.txt'], { string: ['_'] });
  expect(args).toEqual({ _: ['upload'], path: ['a.txt', 'b.txt'] });
});
