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

import { buildEnvironmentReport, detectDisplay, detectHost, detectSandbox, detectShell, renderEnvironmentReport } from '../../src/commands/env';

import type { EnvDeps } from '../../src/commands/env';

function deps(overrides: Partial<EnvDeps> = {}): EnvDeps {
  return {
    platform: 'win32',
    arch: 'x64',
    env: {},
    nodeVersion: 'v24.0.0',
    codePage: () => 65001,
    find: name => name === 'chrome' ? 'C:\\chrome.exe' : undefined,
    intl: () => ({ locale: 'en-US', timeZone: 'UTC' }),
    stateRoot: () => 'C:\\cache\\patchright-cli',
    isWritable: () => true,
    isContainer: () => false,
    ...overrides,
  };
}

test('detectDisplay knows where a headed browser can draw and be seen, per platform', () => {
  // Linux: needs X11/Wayland; xvfb is available but not human-visible.
  expect(detectDisplay('linux', {})).toEqual({ available: false, humanVisible: false, detail: 'no DISPLAY or WAYLAND_DISPLAY' });
  expect(detectDisplay('linux', { DISPLAY: ':0' })).toMatchObject({ available: true, humanVisible: true });
  expect(detectDisplay('linux', { WAYLAND_DISPLAY: 'wayland-0' })).toMatchObject({ available: true, humanVisible: true });
  expect(detectDisplay('linux', { DISPLAY: ':99', XAUTHORITY: '/tmp/xvfb-run.AbCd/Xauthority' })).toMatchObject({ available: true, humanVisible: false });
  // macOS: an SSH login has no window server (no Xvfb equivalent), even when an IDE forwarded
  // its markers; a process started from a GUI app carries LaunchServices/terminal markers;
  // with no markers at all a GUI session is assumed (the default is headless anyway).
  expect(detectDisplay('darwin', { SSH_CONNECTION: '1 2 3 4' })).toMatchObject({ available: false, humanVisible: false });
  expect(detectDisplay('darwin', { SSH_CONNECTION: '1 2 3 4', TERM_PROGRAM: 'vscode' })).toMatchObject({ available: false });
  expect(detectDisplay('darwin', { __CFBundleIdentifier: 'com.apple.Terminal' })).toMatchObject({ available: true, humanVisible: true, detail: expect.stringContaining('GUI session') });
  expect(detectDisplay('darwin', { Apple_PubSub_Socket_Render: '/tmp/x' })).toMatchObject({ available: true, humanVisible: true });
  expect(detectDisplay('darwin', {})).toMatchObject({ available: true, detail: expect.stringContaining('launchctl managername') });
  // Windows: interactive desktop is visible; OpenSSH shell and session-0 service are not.
  expect(detectDisplay('win32', {})).toMatchObject({ available: true, humanVisible: true });
  expect(detectDisplay('win32', { SSH_CONNECTION: '1 2 3 4' })).toMatchObject({ available: false });
  expect(detectDisplay('win32', { SESSIONNAME: 'Services' })).toMatchObject({ available: false });
});

test('detects the shell from environment markers', () => {
  expect(detectShell('win32', { MSYSTEM: 'MINGW64', PSModulePath: 'x' }).name).toBe('git-bash');
  expect(detectShell('win32', { PROMPT: '$P$G' }).name).toBe('cmd');
  expect(detectShell('win32', { PSModulePath: 'C:\\Modules' }).name).toBe('powershell');
  expect(detectShell('win32', {}).name).toBe('unknown');
  expect(detectShell('linux', { SHELL: '/usr/bin/zsh' }).name).toBe('zsh');
  expect(detectShell('darwin', { SHELL: '/bin/bash' }).name).toBe('bash');
  expect(detectShell('linux', {}).name).toBe('sh');
});

test('detects the agent host and sandbox markers', () => {
  expect(detectHost({ CLAUDECODE: '1' })).toEqual({ name: 'Claude Code', evidence: 'CLAUDECODE=1' });
  expect(detectHost({ CODEX_SANDBOX: 'seatbelt' }).name).toBe('Codex CLI');
  expect(detectHost({ COPILOT_CLI: '1' }).name).toBe('GitHub Copilot CLI');
  expect(detectHost({ TERM_PROGRAM: 'vscode' }).name).toBe('terminal (vscode)');
  expect(detectHost({}).name).toBe('unknown');

  const codex = detectSandbox({ CODEX_SANDBOX: 'seatbelt', CODEX_SANDBOX_NETWORK_DISABLED: '1' }, false);
  expect(codex.networkDisabled).toBe(true);
  expect(codex.signals).toEqual(['Codex sandbox (seatbelt)', 'network disabled by the Codex sandbox']);
  const ci = detectSandbox({ GITHUB_ACTIONS: 'true' }, true);
  expect(ci).toEqual({ signals: ['CI runner', 'container'], networkDisabled: null, container: true, ci: true });
  expect(detectSandbox({}, false)).toEqual({ signals: [], networkDisabled: null, container: false, ci: false });
});

test('git bash on windows with a legacy code page: path-conversion and encoding advice', async () => {
  const report = await buildEnvironmentReport(deps({ env: { MSYSTEM: 'MINGW64' }, codePage: () => 1251, intl: () => ({ locale: 'ru-RU', timeZone: 'Europe/Moscow' }) }));
  expect(report.shell.name).toBe('git-bash');
  expect(report.console).toEqual({ codePage: 1251, utf8: false, detail: 'active code page 1251 (not UTF-8)' });
  expect(report.rules.join('\n')).toContain('MSYS_NO_PATHCONV=1');
  expect(report.recommendations.map(r => r.key)).toEqual(['console-encoding']);
  expect(report.locale).toEqual(expect.objectContaining({ language: 'ru-RU', timezone: 'Europe/Moscow' }));
  expect(report.browser).toEqual({ channel: 'chrome', executablePath: 'C:\\chrome.exe' });
  expect(report.network).toEqual({ probed: false, dns: null, tcp: null, detail: expect.stringContaining('env --probe') });
  const text = renderEnvironmentReport(report);
  expect(text).toContain('shell: git-bash (MSYSTEM=MINGW64)');
  expect(text).toContain('[console-encoding]');
  expect(text).toContain('state root: C:\\cache\\patchright-cli (writable)');
});

test('powershell and cmd get their own quoting rules; the permission hint follows the host', async () => {
  const ps = await buildEnvironmentReport(deps({ env: { PSModulePath: 'x', CLAUDECODE: '1' } }));
  expect(ps.rules.join('\n')).toContain('--%');
  expect(ps.rules.join('\n')).toContain('Bash(patchright-cli:*)');
  expect(ps.recommendations).toEqual([]);
  const cmd = await buildEnvironmentReport(deps({ env: { PROMPT: '$P$G' } }));
  expect(cmd.rules.join('\n')).toContain('^&');
  expect(cmd.rules.join('\n')).toContain('ask the user once to allow the `patchright-cli` prefix');
});

test('codex sandbox without network: offline advice, no probe, batch rule', async () => {
  let probed = false;
  const report = await buildEnvironmentReport(deps({
    platform: 'darwin',
    env: { SHELL: '/bin/zsh', CODEX_SANDBOX: 'seatbelt', CODEX_SANDBOX_NETWORK_DISABLED: '1', LANG: 'en_US.UTF-8' },
    probe: async () => { probed = true; return { dns: true, tcp: true }; },
  }));
  expect(probed).toBe(false);
  expect(report.host.name).toBe('Codex CLI');
  expect(report.network.detail).toContain('disabled by the sandbox');
  expect(report.recommendations.map(r => r.key)).toEqual(['no-network']);
  expect(report.rules.join('\n')).toContain('batch');
  expect(report.rules.join('\n')).toContain('approval policy');
  expect(report.rules.join('\n')).toContain('Detected: Codex sandbox (seatbelt), network disabled by the Codex sandbox');
});

test('a read-only state root and a failed probe are reported with the fix', async () => {
  const report = await buildEnvironmentReport(deps({
    platform: 'linux',
    env: { SHELL: '/bin/bash', LANG: 'C.UTF-8', DISPLAY: ':0', CI: 'true' },
    stateRoot: () => '/root/.cache/patchright-cli',
    isWritable: () => false,
    isContainer: () => true,
    probe: async () => ({ dns: false, tcp: false }),
  }));
  expect(report.stateRoot).toEqual({ path: '/root/.cache/patchright-cli', writable: false, detail: 'NOT writable' });
  expect(report.network).toEqual({ probed: true, dns: false, tcp: false, detail: 'dns FAILED, tcp FAILED' });
  expect(report.sandbox.signals).toEqual(['CI runner', 'container']);
  expect(report.recommendations.map(r => r.key).sort()).toEqual(['no-network', 'state-root']);
  expect(report.recommendations.find(r => r.key === 'state-root')!.message).toContain('PATCHRIGHT_CLI_HOME');
});

test('linux without a display and with a C locale is flagged; bundled chromium warns', async () => {
  const report = await buildEnvironmentReport(deps({ platform: 'linux', env: { SHELL: '/bin/bash', LANG: 'C' }, find: name => name === 'chromium' ? '/opt/chromium' : undefined }));
  expect(report.display).toEqual({ available: false, humanVisible: false, detail: 'no DISPLAY or WAYLAND_DISPLAY' });
  expect(report.console.utf8).toBe(false);
  expect(report.recommendations.map(r => r.key).sort()).toEqual(['bundled-chromium', 'console-encoding', 'no-display']);
  expect(report.rules.join('\n')).toContain('POSIX shell');
  // Displayless is a first-class environment: the default (headless) still works; only --headed needs a screen.
  expect(report.rules.join('\n')).toMatch(/headless by default and works here/);
  expect(report.recommendations.find(r => r.key === 'no-display')!.message).toMatch(/default \(headless\) works as is/);

  const ok = await buildEnvironmentReport(deps({ platform: 'linux', env: { SHELL: '/bin/bash', LANG: 'en_US.UTF-8', DISPLAY: ':0' }, probe: async () => ({ dns: true, tcp: true }) }));
  expect(ok.display).toEqual({ available: true, humanVisible: true, detail: 'DISPLAY=:0 WAYLAND_DISPLAY=' });
  expect(ok.network).toEqual({ probed: true, dns: true, tcp: true, detail: 'dns ok, tcp ok' });
  expect(ok.recommendations).toEqual([]);
});

test('no browser at all is a recommendation, not a crash', async () => {
  const report = await buildEnvironmentReport(deps({ find: () => undefined }));
  expect(report.browser).toBeNull();
  expect(report.recommendations.map(r => r.key)).toEqual(['no-browser']);
});
