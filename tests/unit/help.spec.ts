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
import { test, expect } from 'patchright/test';

import { coreHelpJsonPath, corePackageJSON } from '../../src/core';
import { loadHelp } from '../../src/help';
import { applyOverlay } from '../../src/help/overlay';

import type { HelpJson } from '../../src/help/overlay';

const coreHelp = (): HelpJson => JSON.parse(fs.readFileSync(coreHelpJsonPath, 'utf8'));

test('generated help matches the installed patchright-core', () => {
  const help = loadHelp();
  expect(help._generatedFrom).toBe(`${corePackageJSON.name}@${corePackageJSON.version}`);
  expect(help).toEqual(applyOverlay(coreHelp(), help._generatedFrom));
});

test('every command is renamed and no playwright-cli string survives', () => {
  const help = loadHelp();
  expect(help.global).toContain('patchright-cli');
  expect(help.global).not.toMatch(/\bplaywright-cli\b/);
  for (const [name, command] of Object.entries(help.commands)) {
    expect(command.help, name).toContain(`patchright-cli ${name}`);
    expect(command.help, name).not.toMatch(/\bplaywright-cli\b/);
  }
});

test('client-only flags and commands are documented and parseable', () => {
  const help = loadHelp();
  const open = help.commands.open;
  for (const flag of ['headless', 'isolated', 'proxy', 'geoip', 'locale', 'timezone', 'humanize']) {
    expect(open.flags[flag], flag).toBeDefined();
    expect(open.help, flag).toContain(`--${flag}`);
  }
  expect(open.help).toContain('chromium channel to use: chrome (default), msedge or chromium');
  expect(open.help).not.toContain('firefox, webkit');
  expect(help.commands.eval.flags['main-world']).toBe('boolean');
  expect(help.commands.attach.flags.extension).toBeUndefined();
  expect(help.commands.attach.help).not.toContain('--extension');
  for (const flag of ['headless', 'isolated', 'geoip', 'humanize', 'main-world', 'focus-emulation'])
    expect(help.booleanOptions, flag).toContain(flag);
  for (const name of ['identity', 'doctor', 'selftest']) {
    expect(help.commands[name].help).toContain(`patchright-cli ${name}`);
    expect(help.global).toMatch(new RegExp(`^  ${name}\\s{2,}\\S`, 'm'));
  }
  const stealthIndex = help.global.indexOf('Stealth:');
  expect(stealthIndex).toBeGreaterThan(0);
  expect(stealthIndex).toBeLessThan(help.global.indexOf('Browser sessions:'));
});

test('every upstream command is either kept or explicitly removed', () => {
  const help = loadHelp();
  const core = coreHelp();
  for (const name of Object.keys(core.commands))
    expect(name in help.commands, name).toBe(true);
  expect(help.booleanOptions).toEqual(expect.arrayContaining(core.booleanOptions));
});

test('overlay drops removed commands from the global help', () => {
  const core: HelpJson = {
    global: 'Usage: playwright-cli <command>\n\nCore:\n  open [url]                  open the browser\n  console                     list console messages\n',
    commands: {
      open: { help: 'playwright-cli open [url]', flags: {}, args: ['url'] },
      console: { help: 'playwright-cli console', flags: {}, args: [] },
    },
    booleanOptions: ['headed'],
  };
  const generated = applyOverlay(core, 'test@0', { rename: [[/\bplaywright-cli\b/g, 'patchright-cli']], removeCommands: ['console'], removeFlags: {}, flagHelp: {}, addFlags: {}, addCommands: [] });
  expect(Object.keys(generated.commands)).toEqual(['open']);
  expect(generated.global).toBe('Usage: patchright-cli <command>\n\nCore:\n  open [url]                  open the browser\n');
  expect(generated.commands.open.help).toBe('patchright-cli open [url]');
});
