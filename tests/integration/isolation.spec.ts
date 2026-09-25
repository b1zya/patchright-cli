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

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { test, expect } from 'patchright/test';

import { homeDir, parseJson, runCli } from '../fixtures';

test('keeps session state under its own root and kill-all only touches its own daemons', async ({}) => {
  const opened = parseJson(await runCli(['open', 'data:text/html,hello', '--json']));
  expect(opened.session).toBe('default');
  expect(opened.pid).toEqual(expect.any(Number));

  // The daemon computes the same workspace hash as the client and writes into our root.
  const daemonRoot = path.join(homeDir(), 'daemon');
  const hashDirs = fs.readdirSync(daemonRoot);
  expect(hashDirs).toHaveLength(1);
  const sessionFile = path.join(daemonRoot, hashDirs[0], 'default.session');
  expect(fs.existsSync(sessionFile)).toBe(true);
  expect(fs.existsSync(path.join(homeDir(), 'ms-playwright'))).toBe(false);

  const listed = parseJson(await runCli(['list', '--json']));
  expect(listed.browsers).toEqual([expect.objectContaining({ name: 'default', status: 'open' })]);

  // Scope kill-all to our own pid so a parallel test worker's daemon survives.
  const killed = parseJson(await runCli(['kill-all', '--json'], { PWTEST_KILL_ALL_PID_FILTER_FOR_TEST: String(opened.pid) }));
  expect(killed.pids).toEqual([opened.pid]);

  expect(await runCli(['list'])).toEqual(expect.objectContaining({ output: expect.stringContaining('(no browsers)') }));
});

test('install creates the workspace marker and copies the bundled skill', async ({}) => {
  const cwd = test.info().outputPath();
  const result = parseJson(await runCli(['install', '--skills', '--json']));
  expect(result).toEqual(expect.objectContaining({ installed: true, workspaceDir: cwd }));

  expect(fs.existsSync(path.join(cwd, '.playwright'))).toBe(true);
  const skillDir = path.join(cwd, '.claude', 'skills', 'patchright-cli');
  expect(result.skillDir).toBe(skillDir);
  expect(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).toContain('name: patchright-cli');
  expect(fs.existsSync(path.join(skillDir, 'references', 'session-management.md'))).toBe(true);
  // Never the upstream skill, and never a browser download.
  expect(fs.existsSync(path.join(cwd, '.claude', 'skills', 'playwright-cli'))).toBe(false);
  expect(fs.existsSync(path.join(cwd, '.playwright', 'cli.config.json'))).toBe(false);

  const agents = parseJson(await runCli(['install', '--skills=agents', '--json']));
  expect(agents.skillDir).toBe(path.join(cwd, '.agents', 'skills', 'patchright-cli'));
  expect(fs.existsSync(path.join(agents.skillDir, 'SKILL.md'))).toBe(true);
});

test('help and version are branded', async ({}) => {
  const help = await runCli(['--help'], { CLAUDECODE: '1' });
  expect(help.exitCode).toBe(0);
  expect(help.output).toContain('patchright-cli');
  expect(help.output).not.toContain('playwright-cli');
  expect(help.output).toContain(path.join('skills', 'patchright-cli', 'SKILL.md'));

  const click = await runCli(['click', '--help']);
  expect(click.output).toContain('patchright-cli click');

  const version = parseJson(await runCli(['--version', '--json']));
  expect(version).toEqual({ version: expect.any(String), core: { name: 'patchright-core', version: expect.any(String) } });
});

test('env reports the shell, encoding, display and rules without a browser', async ({}) => {
  const result = await runCli(['env', '--json'], { MSYSTEM: 'MINGW64', CI: '1' });
  expect(result.exitCode, result.error).toBe(0);
  const report = parseJson(result);
  expect(report.platform).toBe(process.platform);
  expect(report.shell).toEqual({ name: 'git-bash', evidence: 'MSYSTEM=MINGW64' });
  expect(report.rules.join('\n')).toContain('MSYS_NO_PATHCONV=1');
  expect(report.locale.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(typeof report.display.available).toBe('boolean');
  expect(report.browser).toEqual(expect.objectContaining({ channel: expect.stringMatching(/^(chrome|msedge|chromium)$/) }));
  // The test harness sets CI=1 and PATCHRIGHT_CLI_HOME under the test output dir.
  expect(report.sandbox.ci).toBe(true);
  expect(report.stateRoot).toEqual(expect.objectContaining({ path: homeDir(), writable: true }));
  expect(report.network.probed).toBe(false);
  const text = await runCli(['env']);
  expect(text.output).toContain('### How to run commands here');
  expect(text.output).toContain('- agent host:');
});

test('batch runs a whole flow in one invocation and stops on the first failure', async ({}) => {
  const cwd = test.info().outputPath();
  const script = path.join(cwd, 'flow.txt');
  fs.writeFileSync(script, [
    '# whole flow in one call',
    'open "data:text/html,<title>batch</title><button id=b>go</button>"',
    'eval --main-world --raw "document.title"',
    'close',
  ].join('\n'));
  const result = await runCli(['-s=flow', 'batch', 'flow.txt']);
  expect(result.exitCode, result.error).toBe(0);
  expect(result.output).toContain('### 2: patchright-cli open "data:text/html');
  expect(result.output).toContain('"batch"');
  expect(result.output).toContain("### 4: patchright-cli close");
  expect((await runCli(['list'])).output).toContain('(no browsers)');

  fs.writeFileSync(script, ['open data:text/html,x', 'nonexistent-command', 'close'].join('\n'));
  const failed = await runCli(['-s=flow', 'batch', 'flow.txt', '--json']);
  expect(failed.exitCode).toBe(1);
  const payload = parseJson(failed);
  expect(payload.failed).toBe(true);
  expect(payload.steps.map((s: any) => s.line)).toEqual([1, 2]);
  expect(payload.steps[1].exitCode).toBe(1);
  // Stopped before `close`: the session is still open, as the text mode would have warned.
  expect((await runCli(['list'])).output).toContain('flow');
  expect(await runCli(['-s=flow', 'close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});

test('the representative workflow runs headless: launch, navigate, read content, exit cleanly (no display needed)', async ({}) => {
  // The default mode is headless, so this is the path that must work on servers, CI runners
  // and containers with no graphical desktop. It launches, reads the DOM and the page main
  // world, snapshots and exits cleanly.
  const page = 'data:text/html,<title>headless ok</title><h1 id=h>Hello</h1><script>window.__state = { items: 3 }</script>';
  const opened = parseJson(await runCli(['-s=hless', 'open', page, '--json']));
  expect(opened.session).toBe('hless');
  const cfg = JSON.parse(parseJson(await runCli(['-s=hless', 'config-print', '--json'])).result);
  expect(cfg.browser.launchOptions.headless).toBe(true);
  expect((await runCli(['-s=hless', '--raw', 'eval', "() => document.getElementById('h').textContent"])).output).toBe('"Hello"');
  expect((await runCli(['-s=hless', '--raw', 'eval', '--main-world', '() => window.__state.items'])).output).toBe('3');
  expect((await runCli(['-s=hless', 'snapshot'])).output).toContain('Hello');
  expect(await runCli(['-s=hless', 'close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
  expect((await runCli(['list'])).output).not.toContain('hless');
});

test('wait-for-user rejects a bad timeout and refuses an invisible (headless) window', async ({}) => {
  // The seconds argument is validated before anything opens.
  const bad = await runCli(['-s=blind', 'wait-for-user', 'soon']);
  expect(bad.exitCode).toBe(1);
  expect(bad.output + bad.error).toContain('positive number of seconds');

  // The default session is headless (invisible). Handing that window to the user is exactly
  // the mistake the command prevents: it refuses and tells the agent to reopen headed.
  const opened = await runCli(['-s=blind', 'open', 'data:text/html,<title>blind</title>']);
  expect(opened.exitCode, opened.error).toBe(0);
  const refused = await runCli(['-s=blind', 'wait-for-user', '1']);
  expect(refused.exitCode).toBe(1);
  expect(refused.output + refused.error).toMatch(/headless: the user cannot see/);
  expect(await runCli(['-s=blind', 'close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});

test('wait-for-user hands over a visible window and returns on timeout with a snapshot', async ({}) => {
  // The handover needs a real, human-visible window; skip on a headless Linux host (CI without xvfb).
  test.skip(process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY, 'headed needs a display');
  const opened = await runCli(['-s=handover', 'open', '--headed', 'data:text/html,<title>handover</title><p>type here</p>']);
  expect(opened.exitCode, opened.error).toBe(0);
  const waited = await runCli(['-s=handover', 'wait-for-user', '2']);
  expect(waited.exitCode, waited.error).toBe(0);
  expect(waited.output).toContain('No navigation within 2s');
  expect(waited.output).toContain('### Snapshot');
  const json = parseJson(await runCli(['-s=handover', 'wait-for-user', '1', '--json']));
  expect(json).toEqual(expect.objectContaining({ navigated: false, waitedSeconds: 1, url: expect.stringContaining('data:text/html') }));
  expect(await runCli(['-s=handover', 'close'])).toEqual(expect.objectContaining({ exitCode: 0 }));
});

function watchdogLog(sessionName: string): string {
  const daemonRoot = path.join(homeDir(), 'daemon');
  for (const hash of fs.readdirSync(daemonRoot)) {
    const file = path.join(daemonRoot, hash, `${sessionName}.watchdog.log`);
    if (fs.existsSync(file))
      return fs.readFileSync(file, 'utf8');
  }
  return '';
}

test('a session nobody comes back to closes itself after the idle timeout', async ({}) => {
  const env = { PATCHRIGHT_CLI_WATCHDOG_INTERVAL_MS: '300' };
  const opened = await runCli(['-s=idle', 'open', '--idle-timeout=1s', 'data:text/html,<title>idle</title>'], env);
  expect(opened.exitCode, opened.error).toBe(0);
  expect((await runCli(['list'], env)).output).toContain('lifetime: closes after 1s without a command');
  await new Promise(resolve => setTimeout(resolve, 4000));
  expect((await runCli(['list'], env)).output).toContain('(no browsers)');
  expect(watchdogLog('idle')).toContain('closing the browser: no command for 1s');
  expect(watchdogLog('idle')).toContain('closed');
});

test('a session closes when the process that owns it exits, and an explicit close stops the watchdog', async ({}) => {
  const env = { PATCHRIGHT_CLI_WATCHDOG_INTERVAL_MS: '300' };
  const owner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'ignore' });
  try {
    const opened = await runCli(['-s=owned', 'open', `--owner-pid=${owner.pid}`, '--idle-timeout=0', 'data:text/html,<title>owned</title>'], env);
    expect(opened.exitCode, opened.error).toBe(0);
    expect((await runCli(['list'], env)).output).toContain(`lifetime: closes when process ${owner.pid} exits`);
    owner.kill();
    await new Promise(resolve => owner.on('exit', resolve));
    await new Promise(resolve => setTimeout(resolve, 2500));
    expect((await runCli(['list'], env)).output).toContain('(no browsers)');
    expect(watchdogLog('owned')).toContain(`owner process ${owner.pid} exited`);
  } finally {
    owner.kill();
  }

  // An explicit close takes the watchdog down with the daemon; the log records nothing more.
  const again = await runCli(['-s=owned', 'open', '--idle-timeout=1h', 'data:text/html,<title>again</title>'], env);
  expect(again.exitCode, again.error).toBe(0);
  expect(await runCli(['-s=owned', 'close'], env)).toEqual(expect.objectContaining({ exitCode: 0 }));
  await new Promise(resolve => setTimeout(resolve, 800));
  expect(watchdogLog('owned')).not.toContain('no command for 1h');
});

test('inside an agent harness the 30 minute idle default applies and is announced; a flag turns it off', async ({}) => {
  const agent = { CLAUDECODE: '1' };
  const opened = parseJson(await runCli(['-s=agent', 'open', 'data:text/html,<title>agent</title>', '--json'], agent));
  expect(opened.warnings.filter((w: any) => w.key !== 'headless-user-agent' && w.key !== 'headless-screen')).toEqual([expect.objectContaining({ key: 'lifetime', kind: 'notice', message: expect.stringMatching(/^closes after 30m idle(?: or when process \d+ \(\w+\) exits)?; --idle-timeout=0 and --no-owner-pid keep it open$/) })]);
  // The launch facts travel with the JSON result and open the text output, once.
  expect(opened.launch).toEqual(expect.objectContaining({ channel: expect.any(String), executablePath: expect.any(String), headless: true, profileDir: expect.stringContaining('ud-agent-') }));
  const textOpen = await runCli(['-s=agent', 'open', 'data:text/html,<title>text</title>'], agent);
  expect(textOpen.output).toMatch(/^### Browser `agent` opened with pid \d+: (chrome|msedge|bundled chromium) \d+.*, headless, profile ud-agent-/m);
  expect((await runCli(['list'], agent)).output).toContain('lifetime: closes after 30m without a command');
  const kept = parseJson(await runCli(['-s=agent', 'open', 'data:text/html,<title>kept</title>', '--idle-timeout=0', '--json'], agent));
  expect((kept.warnings ?? []).map((w: any) => w.key)).not.toContain('lifetime');
  expect((await runCli(['list'], agent)).output).not.toContain('lifetime:');
  expect(await runCli(['-s=agent', 'close'], agent)).toEqual(expect.objectContaining({ exitCode: 0 }));
});

test('reads the session name from PATCHRIGHT_CLI_SESSION', async ({}) => {
  const result = await runCli(['snapshot'], { PATCHRIGHT_CLI_SESSION: 'todo' });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain(`The browser 'todo' is not open`);
  expect(result.output).toContain('patchright-cli -s=todo open');
});
