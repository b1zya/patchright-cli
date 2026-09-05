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

import os from 'os';
import path from 'path';
import { test, expect } from 'patchright/test';

import { browsersPathVariable, coreEnvOverrides, coreProcessEnv } from '../../src/daemonEnv';
import { cacheDir, daemonRoot, skillInstallCommand, skillInstallDir, socketsDir, stateRoot } from '../../src/paths';

function withHome<T>(home: string | undefined, fn: () => T): T {
  const previous = process.env.PATCHRIGHT_CLI_HOME;
  if (home === undefined)
    delete process.env.PATCHRIGHT_CLI_HOME;
  else
    process.env.PATCHRIGHT_CLI_HOME = home;
  try {
    return fn();
  } finally {
    if (previous === undefined)
      delete process.env.PATCHRIGHT_CLI_HOME;
    else
      process.env.PATCHRIGHT_CLI_HOME = previous;
  }
}

test('state root defaults to the user cache and honors PATCHRIGHT_CLI_HOME', () => {
  expect(withHome(undefined, stateRoot)).toBe(path.join(cacheDir(), 'patchright-cli'));
  expect(withHome('/tmp/x', stateRoot)).toBe('/tmp/x');
  expect(withHome('/tmp/x', daemonRoot)).toBe(path.join('/tmp/x', 'daemon'));
});

test('sockets dir is short, under tmpdir, and unique per state root', () => {
  const a = withHome('/tmp/a', socketsDir);
  const b = withHome('/tmp/b', socketsDir);
  expect(a).not.toBe(b);
  expect(path.dirname(a)).toBe(os.tmpdir());
  expect(path.basename(a)).toMatch(/^patchright-cli-[0-9a-f]{8}$/);
});

test('daemon env points every core hook into the state root', () => {
  const overrides = withHome('/tmp/root', coreEnvOverrides);
  expect(overrides.PWTEST_DAEMON_SESSION_DIR).toBe(path.join('/tmp/root', 'daemon'));
  expect(overrides.PWTEST_SERVER_REGISTRY).toBe(path.join('/tmp/root', 'b'));
  expect(overrides.PWTEST_CLI_GLOBAL_CONFIG).toBe(path.join('/tmp/root', 'noglobal'));
  expect(overrides.PWMCP_PROFILES_DIR_FOR_TEST).toBe(path.join('/tmp/root', 'profiles'));
  expect(overrides.PWTEST_SOCKETS_DIR).toBe(withHome('/tmp/root', socketsDir));
});

test('skill install targets and repair commands', () => {
  expect(skillInstallDir('claude', '/w')).toBe(path.join('/w', '.claude', 'skills', 'patchright-cli'));
  expect(skillInstallDir('agents', '/w')).toBe(path.join('/w', '.agents', 'skills', 'patchright-cli'));
  expect(skillInstallCommand('claude')).toBe('patchright-cli install --skills');
  expect(skillInstallCommand('agents', true)).toBe('patchright-cli install --skills=agents --global');
});

test('the daemon never sees the core\'s own PLAYWRIGHT_MCP_* overrides; the browsers path is exposed under this tool\'s name', () => {
  const saved = { ...process.env };
  try {
    process.env.PLAYWRIGHT_MCP_HEADLESS = '0';
    process.env.PLAYWRIGHT_MCP_USER_AGENT = 'Spoofed/1.0';
    process.env[browsersPathVariable] = '/srv/browsers';
    delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    const env = withHome('/tmp/root', () => coreProcessEnv({ EXTRA: '1' }));
    expect(Object.keys(env).filter(key => key.startsWith('PLAYWRIGHT_MCP_'))).toEqual([]);
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe('/srv/browsers');
    expect(env.EXTRA).toBe('1');
    expect(env.PWTEST_DAEMON_SESSION_DIR).toBeDefined();
    // The core variable set by the user wins over the alias.
    process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw';
    expect(withHome('/tmp/root', () => coreProcessEnv()).PLAYWRIGHT_BROWSERS_PATH).toBe('/opt/pw');
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in saved))
        delete process.env[key];
    Object.assign(process.env, saved);
  }
});
