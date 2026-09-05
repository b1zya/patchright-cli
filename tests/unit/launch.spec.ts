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

import { cliDaemonPath } from '../../src/core';
import { Session } from '../../src/session';
import { daemonFlagsFromArgs, noopStealth } from '../../src/stealth';

test('daemon argv: flags in upstream order, generated config always last', () => {
  expect(Session.daemonArgs('todo', { headed: true, persistent: true, browser: 'chrome', cdp: 'http://x' }, '/c.json'))
      .toEqual([cliDaemonPath, 'todo', '--headed', '--browser=chrome', '--persistent', '--cdp=http://x', '--config=/c.json']);
  expect(Session.daemonArgs('default', {}, '/c.json')).toEqual([cliDaemonPath, 'default', '--config=/c.json']);
  // --extension wins over --cdp / --endpoint, as upstream.
  expect(Session.daemonArgs('s', { extension: true, cdp: 'x', endpoint: 'y' }, '/c.json'))
      .toEqual([cliDaemonPath, 's', '--extension', '--config=/c.json']);
});

test('daemon flags are picked from parsed args, false and undefined dropped', () => {
  expect(daemonFlagsFromArgs({ _: ['open'], headed: true, persistent: false, device: 'Pixel 10', json: true, session: 'x' }))
      .toEqual({ headed: true, device: 'Pixel 10' });
});

test('noop stealth passes the user config through and defaults the output dir', async () => {
  const profile = await noopStealth.resolveLaunchProfile({
    mode: 'open',
    sessionName: 'default',
    cwd: '/cwd',
    workspaceDir: '/ws',
    args: { _: ['open'], headed: true },
    userConfig: { browser: { launchOptions: { channel: 'msedge' } }, stealth: { humanize: true } },
    daemonProfilesDir: '/root/daemon/hash',
  });
  expect(profile.daemonFlags).toEqual({ headed: true });
  expect(profile.daemonConfig).toEqual({ browser: { launchOptions: { channel: 'msedge' } }, outputDir: path.join('/ws', '.patchright-cli') });
  expect(profile.warnings).toEqual([]);
});
