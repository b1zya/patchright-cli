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

import { loadUserConfig, mergeConfig, projectConfigFile, toDaemonConfig } from '../../src/config/load';

function write(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
}

function withGlobalConfig<T>(file: string, fn: () => T): T {
  const previous = process.env.PATCHRIGHT_CLI_CONFIG;
  process.env.PATCHRIGHT_CLI_CONFIG = file;
  try {
    return fn();
  } finally {
    if (previous === undefined)
      delete process.env.PATCHRIGHT_CLI_CONFIG;
    else
      process.env.PATCHRIGHT_CLI_CONFIG = previous;
  }
}

test('layers global < project < sessions.<name>', () => {
  const cwd = test.info().outputPath('ws');
  const globalFile = test.info().outputPath('home', 'config.json');
  write(globalFile, { timeouts: { action: 1, navigation: 2 }, stealth: { humanize: true }, sessions: { todo: { timeouts: { action: 100 } } } });
  write(projectConfigFile(cwd), { timeouts: { action: 10 }, browser: { launchOptions: { channel: 'msedge' } }, sessions: { todo: { stealth: { humanize: false } } } });

  const base = withGlobalConfig(globalFile, () => loadUserConfig({ cwd, workspaceDir: cwd, sessionName: 'default' }));
  expect(base.warnings).toEqual([]);
  expect(base.sources.map(s => s.kind)).toEqual(['global', 'project']);
  expect(base.config).toEqual({
    timeouts: { action: 10, navigation: 2 },
    stealth: { humanize: true },
    browser: { launchOptions: { channel: 'msedge' } },
  });

  const todo = withGlobalConfig(globalFile, () => loadUserConfig({ cwd, workspaceDir: cwd, sessionName: 'todo' }));
  expect(todo.config.timeouts).toEqual({ action: 100, navigation: 2 });
  expect(todo.config.stealth).toEqual({ humanize: false });
});

test('tolerates a BOM and ignores a malformed non-explicit file with a warning', () => {
  const cwd = test.info().outputPath('ws');
  const globalFile = test.info().outputPath('home', 'config.json');
  write(globalFile, '{ not json');
  write(projectConfigFile(cwd), '﻿{ "timeouts": { "action": 7 } }');

  const loaded = withGlobalConfig(globalFile, () => loadUserConfig({ cwd, workspaceDir: cwd, sessionName: 'default' }));
  expect(loaded.config).toEqual({ timeouts: { action: 7 } });
  expect(loaded.warnings).toEqual([expect.stringContaining('Ignoring malformed config file')]);
  expect(loaded.sources.map(s => s.kind)).toEqual(['project']);
});

test('an explicit --config file must exist and parse', () => {
  const cwd = test.info().outputPath('ws');
  const globalFile = test.info().outputPath('home', 'missing.json');
  expect(() => withGlobalConfig(globalFile, () => loadUserConfig({ cwd, sessionName: 'default', explicitPath: 'nope.json' })))
      .toThrow(/Config file not found/);
  write(path.join(cwd, 'bad.json'), '[]');
  expect(() => withGlobalConfig(globalFile, () => loadUserConfig({ cwd, sessionName: 'default', explicitPath: 'bad.json' })))
      .toThrow(/Could not parse config file/);
});

test('resolves file paths relative to the config file', () => {
  const cwd = test.info().outputPath('ws');
  const globalFile = test.info().outputPath('home', 'missing.json');
  write(path.join(cwd, 'conf', 'c.json'), { browser: { initScript: ['init.js'], userDataDir: '../profile' }, outputDir: 'out' });
  const loaded = withGlobalConfig(globalFile, () => loadUserConfig({ cwd, sessionName: 'default', explicitPath: path.join('conf', 'c.json') }));
  expect(loaded.config.browser?.initScript).toEqual([path.join(cwd, 'conf', 'init.js')]);
  expect(loaded.config.browser?.userDataDir).toBe(path.join(cwd, 'profile'));
  expect(loaded.config.outputDir).toBe(path.join(cwd, 'conf', 'out'));
});

test('merge keeps null, drops undefined and replaces arrays', () => {
  const merged = mergeConfig(
      { browser: { launchOptions: { headless: true, args: ['--a'] }, contextOptions: { viewport: { width: 1, height: 1 } } } },
      { browser: { launchOptions: { headless: undefined, args: ['--b'] }, contextOptions: { viewport: null } } },
  );
  expect(merged.browser).toEqual({ launchOptions: { headless: true, args: ['--b'] }, contextOptions: { viewport: null } });
});

test('daemon config strips our block and defaults the output dir', () => {
  expect(toDaemonConfig({ stealth: { humanize: true }, timeouts: { action: 5 } }, { outputDir: '/w/.patchright-cli' }))
      .toEqual({ timeouts: { action: 5 }, outputDir: '/w/.patchright-cli' });
  expect(toDaemonConfig({ outputDir: '/custom' }, { outputDir: '/w/.patchright-cli' })).toEqual({ outputDir: '/custom' });
});
