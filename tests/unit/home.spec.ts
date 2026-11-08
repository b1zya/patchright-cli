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

import { collectHome, homeHints, parseTabList, renderHome } from '../../src/commands/home';
import { namedProfilesDir } from '../../src/paths';

import type { HomeProbe } from '../../src/commands/home';
import type { ClientInfo, Registry, SessionFile } from '../../src/registry';

const clientInfo = { version: '1.64.3', workspaceDirHash: 'h', daemonProfilesDir: '/d', workspaceDir: '/ws', homeDir: '/home' } as ClientInfo;

function entry(name: string, options: { version?: string, headless?: boolean, userDataDir?: string, attached?: boolean } = {}): SessionFile {
  return {
    file: '',
    daemonDir: path.join('/nonexistent', name),
    config: {
      name,
      version: options.version ?? '1.64.3',
      attached: options.attached,
      cli: {},
      browser: { browserName: 'chromium', launchOptions: { channel: 'chrome', headless: options.headless ?? true }, userDataDir: options.userDataDir },
    },
  } as unknown as SessionFile;
}

function registryOf(byWorkspace: Record<string, SessionFile[]>): Registry {
  return { entryMap: () => new Map(Object.entries(byWorkspace)) } as unknown as Registry;
}

test('parses the daemon\'s raw tab-list, current tab included', () => {
  expect(parseTabList('- 0: [Example Domain](https://example.com/)\n- 1: (current) [A [nested] title](about:blank)')).toEqual({
    tabs: 2,
    current: { index: 1, title: 'A [nested] title', url: 'about:blank' },
  });
  expect(parseTabList('### Result\r\n- 0: (current) [](data:text/html,x)\r\n')).toEqual({ tabs: 1, current: { index: 0, title: '', url: 'data:text/html,x' } });
  expect(parseTabList('')).toEqual({ tabs: 0, current: undefined });
});

test('lists only live sessions of this workspace, default first, and says why one could not be read', async () => {
  const registry = registryOf({
    '/ws': [
      entry('zeta', { headless: false, userDataDir: path.join(namedProfilesDir(), 'work') }),
      entry('gone'),
      entry('default'),
      entry('stuck'),
      entry('old', { version: '99.0.0' }),
    ],
    '/elsewhere': [entry('foreign')],
  });
  const asked: string[] = [];
  const probe: HomeProbe = async e => {
    asked.push(e.config.name);
    if (e.config.name === 'gone')
      return { alive: false };
    if (e.config.name === 'stuck' || e.config.name === 'old')
      return { alive: true };
    return { alive: true, tabList: `- 0: (current) [${e.config.name}](https://${e.config.name}.test/)` };
  };
  const home = await collectHome({ registry, clientInfo, version: '0.3.0', core: '1.64.3', probe });

  expect(asked.sort()).toEqual(['default', 'gone', 'old', 'stuck', 'zeta']);
  expect(home.sessions.map(s => [s.name, s.status])).toEqual([['default', 'open'], ['old', 'incompatible'], ['stuck', 'busy'], ['zeta', 'open']]);
  expect(home.sessions.find(s => s.name === 'zeta')).toEqual(expect.objectContaining({ headed: true, profile: 'work', tabs: 1, current: { index: 0, title: 'zeta', url: 'https://zeta.test/' } }));
  expect(home.workspace).toBe('/ws');

  const text = renderHome(home);
  expect(text).toContain('Browsers open in this workspace (4):');
  expect(text).toContain('- default: headless chrome, 1 tab, current "default" https://default.test/');
  expect(text).toContain('- zeta: headed chrome, profile work, 1 tab');
  expect(text).toContain('- old: headless chrome, started by a newer patchright-cli; open restarts it');
  expect(text).toContain('- stuck: headless chrome, busy (no answer within 1.5 s)');
  expect(text).toContain('patchright-cli -s=old open');
  expect(text).not.toContain('foreign');
});

test('with nothing open the next step is to open a browser', async () => {
  const home = await collectHome({ registry: registryOf({}), clientInfo, version: '0.3.0', core: '1.64.3', probe: async () => ({ alive: false }) });
  expect(home.sessions).toEqual([]);
  expect(home.next.map(h => h.command)).toEqual(['patchright-cli open <url>', 'patchright-cli env', 'patchright-cli list --all', 'patchright-cli --help']);
  expect(renderHome(home)).toContain('No browser open in this workspace.');
});

test('the snapshot hint names the session it applies to', () => {
  const open = { name: 'work', status: 'open' as const, attached: false };
  expect(homeHints([open])[0].command).toBe('patchright-cli -s=work snapshot');
  expect(homeHints([{ ...open, name: 'default' }, open])[0].command).toBe('patchright-cli snapshot');
});
