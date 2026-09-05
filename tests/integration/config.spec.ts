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

import { parseJson, runCli } from '../fixtures';

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

async function resolvedConfig(env: Record<string, string> = {}): Promise<any> {
  const result = parseJson(await runCli(['config-print', '--json'], env));
  return JSON.parse(result.result);
}

test('the daemon sees our merged config and ignores a stray playwright-cli config', async ({}) => {
  const cwd = test.info().outputPath();
  writeJson(path.join(cwd, '.playwright', 'patchright-cli.config.json'), {
    timeouts: { action: 1234 },
    sessions: { todo: { timeouts: { action: 4321 } } },
  });
  // A playwright-cli project config in the same workspace must not leak into our daemon.
  // (The global ~/.playwright/cli.config.json is neutralized through PWTEST_CLI_GLOBAL_CONFIG,
  // covered by the daemonEnv unit test; redirecting HOME here would break Chrome on Windows.)
  writeJson(path.join(cwd, '.playwright', 'cli.config.json'), { browser: { browserName: 'firefox' }, timeouts: { action: 999 } });
  const home = test.info().outputPath('home');
  const env = {};

  expect(await runCli(['open', 'data:text/html,hello'], env)).toEqual(expect.objectContaining({ exitCode: 0 }));
  const config = await resolvedConfig(env);
  expect(config.timeouts.action).toBe(1234);
  expect(config.browser.browserName).toBe('chromium');
  expect(config.outputDir).toBe(path.join(cwd, '.patchright-cli'));

  // Output lands in our directory, not in .playwright-cli.
  const shot = await runCli(['screenshot']);
  expect(shot.exitCode).toBe(0);
  expect(fs.readdirSync(path.join(cwd, '.patchright-cli')).some(f => f.endsWith('.png'))).toBe(true);
  expect(fs.existsSync(path.join(cwd, '.playwright-cli'))).toBe(false);
  expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));

  // The generated daemon config is not left behind.
  const daemonRoot = path.join(home, 'daemon');
  for (const hash of fs.readdirSync(daemonRoot))
    expect(fs.readdirSync(path.join(daemonRoot, hash)).filter(f => f.endsWith('.daemon.json'))).toEqual([]);

  // Per-session overrides apply by session name.
  expect(await runCli(['-s=todo', 'open', 'data:text/html,todo'], env)).toEqual(expect.objectContaining({ exitCode: 0 }));
  expect((await resolvedConfig({ ...env, PATCHRIGHT_CLI_SESSION: 'todo' })).timeouts.action).toBe(4321);
  expect(await runCli(['-s=todo', 'close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});

test('--config points at a project config file and a malformed global config only warns', async ({}) => {
  const cwd = test.info().outputPath();
  writeJson(path.join(cwd, 'my.json'), { timeouts: { action: 555 } });
  const globalFile = test.info().outputPath('home', 'config.json');
  fs.mkdirSync(path.dirname(globalFile), { recursive: true });
  fs.writeFileSync(globalFile, '{ nope');
  const env = { PATCHRIGHT_CLI_CONFIG: globalFile };

  const opened = await runCli(['open', 'data:text/html,hello', '--config=my.json', '--json'], env);
  expect(opened.exitCode).toBe(0);
  // The malformed global config is a note; the headless user-agent note is the launch's own.
  expect(parseJson(opened).warnings).toEqual([expect.objectContaining({ key: 'config', kind: 'notice' }), expect.objectContaining({ key: 'headless-user-agent', kind: 'notice' })]);
  expect((await resolvedConfig(env)).timeouts.action).toBe(555);
  expect(await runCli(['close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});
