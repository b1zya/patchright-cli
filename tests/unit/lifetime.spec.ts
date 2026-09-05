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

import { describeDuration, describeLifetime, describeLifetimeNote, isAgentHost, parseDuration, resolveLifetime } from '../../src/lifetime';
import { matchDaemonProcess } from '../../src/killAll';

const alive = (pid: number) => pid === 4242 || pid === 100;

test('durations: units, bare minutes, and the ways to say never', () => {
  expect(parseDuration('30m')).toBe(30 * 60_000);
  expect(parseDuration('2h')).toBe(2 * 3_600_000);
  expect(parseDuration('90s')).toBe(90_000);
  expect(parseDuration('1.5h')).toBe(5_400_000);
  expect(parseDuration('45')).toBe(45 * 60_000);
  expect(parseDuration(15)).toBe(15 * 60_000);
  for (const never of ['0', 'off', 'none', 'never'])
    expect(parseDuration(never)).toBe(0);
  expect(() => parseDuration('soon')).toThrow(/duration like 30m/);
  expect(describeDuration(30 * 60_000)).toBe('30m');
  expect(describeDuration(2 * 3_600_000)).toBe('2h');
  expect(describeDuration(1000)).toBe('1s');
});

test('agent harnesses are detected from their environment markers; plain terminals are not', () => {
  expect(isAgentHost({ CLAUDECODE: '1' })).toBe(true);
  expect(isAgentHost({ CODEX_SANDBOX: 'seatbelt' })).toBe(true);
  expect(isAgentHost({ COPILOT_CLI: '1' })).toBe(true);
  expect(isAgentHost({ TERM_PROGRAM: 'iTerm.app' })).toBe(false);
  expect(isAgentHost({})).toBe(false);
});

test('lifetime precedence: flag > config > agent default > off; owner from the flag or a live harness pid', () => {
  // Nothing asked, plain terminal: the browser stays open, as before.
  expect(resolveLifetime({ _: ['open'] }, {}, {}, alive)).toEqual({ idleMs: 0, idleSource: 'off' });
  // An agent harness gets the 30 minute default.
  expect(resolveLifetime({ _: ['open'] }, {}, { CLAUDECODE: '1' }, alive)).toEqual({ idleMs: 30 * 60_000, idleSource: 'agent-default' });
  // The config overrides the default; the flag overrides the config; 0 disables.
  expect(resolveLifetime({ _: ['open'] }, { idleTimeout: '2h' }, { CLAUDECODE: '1' }, alive)).toEqual({ idleMs: 2 * 3_600_000, idleSource: 'config' });
  expect(resolveLifetime({ _: ['open'], 'idle-timeout': '90s' }, { idleTimeout: '2h' }, {}, alive)).toEqual({ idleMs: 90_000, idleSource: 'flag' });
  expect(resolveLifetime({ _: ['open'], 'idle-timeout': '0' }, {}, { CLAUDECODE: '1' }, alive)).toEqual({ idleMs: 0, idleSource: 'flag' });
  // Owner: the harness variable when that process is alive, never a dead or foreign pid.
  expect(resolveLifetime({ _: ['open'] }, {}, { CLAUDECODE: '1', CLAUDE_PID: '4242' }, alive)).toMatchObject({ idleSource: 'agent-default', ownerPid: 4242, ownerSource: 'env', ownerVariable: 'CLAUDE_PID' });
  expect(resolveLifetime({ _: ['open'] }, {}, { CLAUDE_PID: '999' }, alive).ownerPid).toBeUndefined();
  expect(resolveLifetime({ _: ['open'] }, {}, { PATCHRIGHT_CLI_OWNER_PID: '100', CLAUDE_PID: '4242' }, alive)).toMatchObject({ ownerPid: 100, ownerVariable: 'PATCHRIGHT_CLI_OWNER_PID' });
  expect(resolveLifetime({ _: ['open'], 'owner-pid': '4242' }, {}, {}, alive)).toMatchObject({ ownerPid: 4242, ownerSource: 'flag' });
  expect(resolveLifetime({ _: ['open'], 'owner-pid': false }, {}, { CLAUDE_PID: '4242' }, alive).ownerPid).toBeUndefined();
  expect(resolveLifetime({ _: ['open'], 'owner-pid': '0' }, {}, { CLAUDE_PID: '4242' }, alive).ownerPid).toBeUndefined();
  expect(() => resolveLifetime({ _: ['open'], 'owner-pid': 'me' }, {}, {}, alive)).toThrow(/expects a process id/);
  expect(() => resolveLifetime({ _: ['open'], 'owner-pid': '999' }, {}, {}, alive)).toThrow(/no such process/);
  expect(() => resolveLifetime({ _: ['open'], 'idle-timeout': 'soon' }, {}, {}, alive)).toThrow(/duration/);
});

test('the lifetime is described for people and the watchdog is recognised by kill-all', () => {
  expect(describeLifetime({ idleMs: 30 * 60_000, ownerPid: 4242, ownerVariable: 'CLAUDE_PID' })).toBe('closes after 30m without a command, closes when process 4242 (CLAUDE_PID) exits');
  expect(describeLifetime({ idleMs: 0 })).toBe('stays open until closed');
  // The note on `open` is one line of facts; `list` keeps the longer form above.
  expect(describeLifetimeNote({ idleMs: 30 * 60_000, ownerPid: 4242, ownerVariable: 'CLAUDE_PID' })).toBe('closes after 30m idle or when process 4242 (CLAUDE_PID) exits; --idle-timeout=0 and --no-owner-pid keep it open');
  expect(describeLifetimeNote({ idleMs: 2 * 3_600_000 })).toBe('closes after 2h idle; --idle-timeout=0 and --no-owner-pid keep it open');
  expect(describeLifetimeNote({ idleMs: 0, ownerPid: 100 })).toBe('closes when process 100 exits; --idle-timeout=0 and --no-owner-pid keep it open');
  expect(matchDaemonProcess('node /x/lib/cli.js __patchright-watchdog --session=default --idle-ms=1800000')).toBe(true);
  expect(matchDaemonProcess('node /x/lib/cli.js open https://example.com')).toBe(false);
  // A shell whose command text only mentions the marker is not a watchdog.
  expect(matchDaemonProcess("bash -c \"grep __patchright-watchdog src/killAll.ts\"")).toBe(false);
});
