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

import path from 'path';
import { test, expect } from 'patchright/test';

import { isProfileName, profileHolders, resolveProfileDir } from '../../src/commands/profiles';
import { namedProfilesDir } from '../../src/paths';

import type { Registry, SessionFile } from '../../src/registry';

test('a bare name is a named profile, anything with a path separator is a directory', () => {
  for (const name of ['work', 'acme-login', 'shop_2', 'v1.2'])
    expect(isProfileName(name), name).toBe(true);
  for (const value of ['./work', '../work', '/abs/work', 'C:\work', 'a/b', '.', '..', '.hidden', '-x', ''])
    expect(isProfileName(value), value).toBe(false);
  expect(resolveProfileDir('work', '/ws')).toBe(path.join(namedProfilesDir(), 'work'));
  expect(resolveProfileDir('./work', '/ws')).toBe(path.resolve('/ws', 'work'));
});

test('a profile is held by the live sessions, in any workspace, that run on its directory', async () => {
  const dir = path.join(namedProfilesDir(), 'work');
  const entry = (name: string, userDataDir: string | undefined, daemonDir = '/d1'): SessionFile =>
    ({ file: '', daemonDir, config: { name, workspaceDir: daemonDir, browser: { userDataDir } } } as unknown as SessionFile);
  const registry = { entryMap: () => new Map([
    ['/w1', [entry('one', dir), entry('other', '/elsewhere'), entry('closed', dir)]],
    ['/w2', [entry('two', dir + path.sep, '/d2')]],
  ]) } as unknown as Registry;
  const holders = await profileHolders(registry, dir, async e => e.config.name !== 'closed');
  expect(holders.map(h => h.session)).toEqual(['one', 'two']);
});
