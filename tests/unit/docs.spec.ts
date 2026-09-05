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
import path from 'path';
import { test, expect } from 'patchright/test';

import { loadHelp } from '../../src/help';
import { clientFlags } from '../../src/stealth/flags';
import { catalog } from '../../src/stealth/warnings';

const root = path.join(__dirname, '..', '..');
const skillDir = path.join(root, 'skills', 'patchright-cli');
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const references = fs.readdirSync(path.join(skillDir, 'references')).filter(f => f.endsWith('.md'));
const allSkillText = [skill, ...references.map(f => fs.readFileSync(path.join(skillDir, 'references', f), 'utf8'))].join('\n');

test('the skill mentions every public command', () => {
  const help = loadHelp();
  const missing = Object.keys(help.commands).filter(name => !new RegExp(`(^|[\\s\`])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s\`]|$)`, 'm').test(skill));
  expect(missing).toEqual([]);
});

test('the skill documents every client-only flag', () => {
  const missing = [...new Set(clientFlags.map(flag => `--${flag.name}`))].filter(flag => !allSkillText.includes(flag));
  expect(missing).toEqual([]);
});

test('the skill is English only (agents serve users of any country; the answer language is theirs, the skill language is not)', () => {
  const nonLatinScript = /[Ѐ-ӿͰ-Ͽ֐-׿؀-ۿ぀-ヿ一-鿿가-힯]/;
  for (const file of ['SKILL.md', ...references.map(f => path.join('references', f))]) {
    const text = fs.readFileSync(path.join(skillDir, file), 'utf8');
    const hit = text.split('\n').find(line => nonLatinScript.test(line));
    expect(hit, `${file}: ${hit}`).toBeUndefined();
  }
});

test('the skill and the references carry no removed or upstream-only instructions', () => {
  // The contract table may name refused flags; instructions to use them may not appear.
  for (const banned of ['open --browser=firefox', 'open --browser=webkit', '--extension=', '@playwright/cli', 'npx playwright cli', '.playwright-cli/'])
    expect(allSkillText, banned).not.toContain(banned);
  expect(skill).toMatch(/^name: patchright-cli$/m);
  expect(skill).toMatch(/^allowed-tools: Bash\(patchright-cli:\*\)$/m);
});

test('every reference is linked from the skill and every link resolves', () => {
  const linked = [...skill.matchAll(/\]\(references\/([\w-]+\.md)\)/g)].map(m => m[1]);
  for (const file of references)
    expect(linked, file).toContain(file);
  for (const file of linked)
    expect(references, file).toContain(file);
});

test('the warning catalog is documented in the stealth reference', () => {
  const stealth = fs.readFileSync(path.join(skillDir, 'references', 'stealth.md'), 'utf8');
  for (const key of Object.keys(catalog))
    expect(stealth, key).toContain(`\`${key}\``);
});

test('README only names commands that exist', () => {
  const help = loadHelp();
  const mentioned = [...readme.matchAll(/patchright-cli ([a-z][a-z-]+)/g)].map(m => m[1]).filter(name => !name.startsWith('-'));
  const unknown = mentioned.filter(name => !(name in help.commands) && !['on', 'is', 'and', 'daemons'].includes(name));
  expect([...new Set(unknown)]).toEqual([]);
});
