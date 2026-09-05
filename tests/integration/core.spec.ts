/**
 * Copyright (c) Microsoft Corporation.
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

import { runCli } from '../fixtures';

test('open data URL', async ({}) => {
  expect(await runCli(['open', 'data:text/html,hello', '--persistent'])).toEqual(expect.objectContaining({
    output: expect.stringContaining('hello'),
    exitCode: 0,
  }));

  expect(await runCli(['delete-data'])).toEqual(expect.objectContaining({
    output: expect.stringContaining('Deleted user data for'),
    exitCode: 0,
  }));
});

test('warns when installed skill is out of date', async ({}) => {
  expect(await runCli(['install', '--skills'], { NO_UPDATE_NOTIFIER: '1' })).toEqual(expect.objectContaining({
    exitCode: 0,
  }));

  const skillFile = path.join(test.info().outputPath(), '.claude', 'skills', 'patchright-cli', 'SKILL.md');
  fs.appendFileSync(skillFile, 'x');

  const env = { CI: '', NO_UPDATE_NOTIFIER: '' };
  expect(await runCli(['--help'], env)).toEqual(expect.objectContaining({
    error: expect.stringContaining('does not match the tool version'),
  }));

  expect(await runCli(['--help'], env)).toEqual(expect.objectContaining({
    error: expect.not.stringContaining('does not match the tool version'),
  }));
});

test('warns when an installed reference file drifts', async ({}) => {
  expect(await runCli(['install', '--skills'], { NO_UPDATE_NOTIFIER: '1' })).toEqual(expect.objectContaining({
    exitCode: 0,
  }));

  const reference = path.join(test.info().outputPath(), '.claude', 'skills', 'patchright-cli', 'references', 'stealth.md');
  fs.appendFileSync(reference, 'x');

  expect(await runCli(['--help'], { CI: '', NO_UPDATE_NOTIFIER: '' })).toEqual(expect.objectContaining({
    error: expect.stringContaining('does not match the tool version'),
  }));
});

test('does not warn when installed skill only differs in line endings', async ({}) => {
  expect(await runCli(['install', '--skills'], { NO_UPDATE_NOTIFIER: '1' })).toEqual(expect.objectContaining({
    exitCode: 0,
  }));

  const skillFile = path.join(test.info().outputPath(), '.claude', 'skills', 'patchright-cli', 'SKILL.md');
  fs.writeFileSync(skillFile, fs.readFileSync(skillFile, 'utf8').replace(/\n/g, '\r\n'));

  expect(await runCli(['--help'], { CI: '', NO_UPDATE_NOTIFIER: '' })).toEqual(expect.objectContaining({
    error: expect.not.stringContaining('does not match the tool version'),
  }));
});

test('caches the update check in the default registry directory', async ({}) => {
  // Redirect the home/cache directories so the real user cache is untouched, and
  // leave PATCHRIGHT_CLI_HOME empty so the default path is used.
  const home = test.info().outputPath('home');
  fs.mkdirSync(home, { recursive: true });
  const env = {
    CI: '',
    NO_UPDATE_NOTIFIER: '',
    PATCHRIGHT_CLI_HOME: '',
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: path.join(home, '.cache'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  };

  expect(await runCli(['--version'], env)).toEqual(expect.objectContaining({ exitCode: 0 }));

  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory())
        walk(full);
      else if (entry.name === 'cli-update-check.json')
        found.push(full);
    }
  };
  walk(home);

  expect(found).toHaveLength(1);
  expect(JSON.parse(fs.readFileSync(found[0], 'utf8')).lastCheck).toEqual(expect.any(Number));
});
