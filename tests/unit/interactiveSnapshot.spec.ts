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

import { interactiveJson, interactiveSnapshotRewrite, interactiveYaml } from '../../src/commands/interactiveSnapshot';

import type { Output } from '../../src/output';

const page = [
  '- generic [active] [ref=e1]:',
  '  - heading "Shop" [level=1] [ref=e2]',
  '  - navigation [ref=e3]:',
  '    - link "Home" [ref=e4] [cursor=pointer]:',
  '      - /url: /a',
  '    - list [ref=e5]:',
  '      - listitem [ref=e6]:',
  '        - link "Cart" [ref=e7] [cursor=pointer]:',
  '          - /url: /b',
  '  - paragraph [ref=e8]: Long text paragraph',
  '  - generic [ref=e9]:',
  '    - generic [ref=e10]:',
  '      - text: Email',
  '      - textbox "Email" [ref=e11]',
  '    - generic [ref=e14] [cursor=pointer]: Card that opens a product',
  '    - combobox [ref=e13]:',
  '      - option "A" [selected]',
  '  - region "Empty" [ref=e15]:',
  '    - paragraph [ref=e16]: nothing to act on',
].join('\n');

test('keeps controls with their subtree, headings and landmarks that hold controls; drops the rest', () => {
  expect(interactiveYaml(page)).toBe([
    '- heading "Shop" [level=1] [ref=e2]',
    '- navigation [ref=e3]:',
    '  - link "Home" [ref=e4] [cursor=pointer]:',
    '    - /url: /a',
    '  - link "Cart" [ref=e7] [cursor=pointer]:',
    '    - /url: /b',
    '- textbox "Email" [ref=e11]',
    '- generic [ref=e14] [cursor=pointer]: Card that opens a product',
    '- combobox [ref=e13]:',
    '  - option "A" [selected]',
  ].join('\n'));
});

test('the JSON tree is pruned the same way', () => {
  const tree = [{ role: 'generic', ref: 'e1', children: [
    { role: 'heading', name: 'Shop', ref: 'e2', children: [{ role: 'text', name: 'x' }] },
    { role: 'navigation', ref: 'e3', children: [{ role: 'list', children: [{ role: 'link', name: 'Home', ref: 'e4', url: '/a' }] }] },
    { role: 'paragraph', ref: 'e8' },
    { role: 'generic', ref: 'e14', cursor: 'pointer', children: [{ role: 'text', name: 'Card' }] },
  ] }];
  expect(interactiveJson(tree)).toEqual([
    { role: 'heading', name: 'Shop', ref: 'e2' },
    { role: 'navigation', ref: 'e3', children: [{ role: 'link', name: 'Home', ref: 'e4', url: '/a' }] },
    { role: 'generic', ref: 'e14', cursor: 'pointer', children: [{ role: 'text', name: 'Card' }] },
  ]);
});

test('snapshot --interactive takes the snapshot inline and prints the pruned tree', () => {
  const printed: string[] = [];
  const output = { json: false, toolResult: (text: string) => printed.push(text) } as unknown as Output;
  const rewrite = interactiveSnapshotRewrite({ _: ['snapshot'], interactive: true, depth: '4' }, output, process.cwd());
  expect(rewrite).toEqual(expect.objectContaining({ kind: 'rewrite', args: { _: ['snapshot'], depth: '4' }, raw: true, silent: true }));
  if (rewrite.kind === 'rewrite')
    rewrite.onResult!(page);
  expect(printed[0]).toMatch(/^### Snapshot \(interactive\)\n```yaml\n- heading "Shop"/);
  expect(printed[0]).not.toContain('paragraph');
});
