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

// Session lifetime: a browser nobody comes back to close. `open` spawns the daemon detached
// and the daemon keeps its browser until something sends `stop`; an agent that opens a
// session, finishes and exits never does, and each leaked session keeps a Chrome running at
// full rate (microsoft/playwright-cli#460). The daemon is upstream code we run untouched, so
// the lifetime lives next to it: `open` starts a small watchdog process that polls an
// activity file (touched by every command this client sends to the session) and, when
// asked, the pid of the owner (an agent process), and sends the daemon `stop` when the
// session has been idle for the timeout or the owner is gone. The watchdog exits by itself
// when the session is closed or reopened.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { detectHost } from './commands/env';
import { readState, updateState } from './humanize/state';
import { watchdogMarker } from './killAll';
import { createClientInfo, Registry } from './registry';
import { Session } from './session';

import type { MinimistArgs } from './args';
import type { UserConfigLayer } from './config/schema';
import type { ClientInfo } from './registry';

export const watchdogCommand = watchdogMarker;
export const defaultAgentIdleTimeout = '30m';
// Environment variables an agent harness may set to its own process id.
export const ownerPidVariables = ['PATCHRIGHT_CLI_OWNER_PID', 'CLAUDE_PID'];

export type Lifetime = {
  idleMs: number;
  idleSource: 'flag' | 'config' | 'agent-default' | 'off';
  ownerPid?: number;
  ownerSource?: 'flag' | 'env';
  ownerVariable?: string;
};

// "30m", "2h", "90s", "1.5h"; a bare number is minutes; 0 / off / none disable.
export function parseDuration(value: string | number): number {
  const text = String(value).trim().toLowerCase();
  if (text === '0' || text === 'off' || text === 'none' || text === 'never')
    return 0;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(ms|s|sec|m|min|h|hr|d)?$/);
  if (!match)
    throw new Error(`expected a duration like 30m, 2h or 90s (0 disables), got '${value}'`);
  const amount = Number(match[1]);
  const unit = match[2] ?? 'm';
  const perUnit: Record<string, number> = { ms: 1, s: 1000, sec: 1000, m: 60_000, min: 60_000, h: 3_600_000, hr: 3_600_000, d: 86_400_000 };
  return Math.round(amount * perUnit[unit]);
}

export function describeDuration(ms: number): string {
  if (ms % 3_600_000 === 0)
    return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0)
    return `${ms / 60_000}m`;
  return `${Math.round(ms / 1000)}s`;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM';
  }
}

export function isAgentHost(env: NodeJS.ProcessEnv): boolean {
  const name = detectHost(env).name;
  return name !== 'unknown' && !name.startsWith('terminal');
}

// Precedence: the flag, then the config (`idleTimeout`, per session too), then the agent
// default, else no idle timeout. The owner pid comes from --owner-pid, else from the
// harness variables when that process is alive; --no-owner-pid opts out.
export function resolveLifetime(args: MinimistArgs, config: UserConfigLayer, env: NodeJS.ProcessEnv, alive: (pid: number) => boolean = isProcessAlive): Lifetime {
  const flag = args['idle-timeout'];
  let lifetime: Lifetime;
  if (flag !== undefined && flag !== true && flag !== false)
    lifetime = { idleMs: parseDuration(String(flag)), idleSource: 'flag' };
  else if (config.idleTimeout !== undefined)
    lifetime = { idleMs: parseDuration(String(config.idleTimeout)), idleSource: 'config' };
  else if (isAgentHost(env))
    lifetime = { idleMs: parseDuration(defaultAgentIdleTimeout), idleSource: 'agent-default' };
  else
    lifetime = { idleMs: 0, idleSource: 'off' };

  const owner = args['owner-pid'];
  if (owner !== undefined && owner !== true && owner !== false) {
    const pid = Number(owner);
    if (!Number.isInteger(pid) || pid < 0)
      throw new Error(`--owner-pid expects a process id, got '${owner}'`);
    if (pid > 0) {
      if (!alive(pid))
        throw new Error(`--owner-pid ${pid}: no such process`);
      lifetime.ownerPid = pid;
      lifetime.ownerSource = 'flag';
    }
  } else if (owner !== false) {
    for (const variable of ownerPidVariables) {
      const pid = Number(env[variable]);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && alive(pid)) {
        lifetime.ownerPid = pid;
        lifetime.ownerSource = 'env';
        lifetime.ownerVariable = variable;
        break;
      }
    }
  }
  return lifetime;
}

export function describeLifetime(lifetime: { idleMs: number, ownerPid?: number, ownerVariable?: string }): string {
  const parts: string[] = [];
  if (lifetime.idleMs)
    parts.push(`closes after ${describeDuration(lifetime.idleMs)} without a command`);
  if (lifetime.ownerPid)
    parts.push(`closes when process ${lifetime.ownerPid}${lifetime.ownerVariable ? ` (${lifetime.ownerVariable})` : ''} exits`);
  return parts.length ? parts.join(', ') : 'stays open until closed';
}

// The one-line note `open` prints when a lifetime was applied without being asked for: the
// facts and the two flags that change them. The why lives in references/session-management.md.
export function describeLifetimeNote(lifetime: { idleMs: number, ownerPid?: number, ownerVariable?: string }): string {
  const parts: string[] = [];
  if (lifetime.idleMs)
    parts.push(`closes after ${describeDuration(lifetime.idleMs)} idle`);
  if (lifetime.ownerPid)
    parts.push(`${parts.length ? 'or ' : 'closes '}when process ${lifetime.ownerPid}${lifetime.ownerVariable ? ` (${lifetime.ownerVariable})` : ''} exits`);
  return `${parts.join(' ')}; --idle-timeout=0 and --no-owner-pid keep it open`;
}

// ---- activity ----

function activityFile(daemonProfilesDir: string, sessionName: string): string {
  return path.join(daemonProfilesDir, `${sessionName}.activity`);
}

export function touchActivity(daemonProfilesDir: string, sessionName: string): void {
  try {
    fs.writeFileSync(activityFile(daemonProfilesDir, sessionName), String(Date.now()));
  } catch {
    // The daemon directory may be gone (delete-data raced us); nothing to record then.
  }
}

export function lastActivity(daemonProfilesDir: string, sessionName: string): number | undefined {
  try {
    const value = Number(fs.readFileSync(activityFile(daemonProfilesDir, sessionName), 'utf8'));
    return Number.isFinite(value) && value > 0 ? value : fs.statSync(activityFile(daemonProfilesDir, sessionName)).mtimeMs;
  } catch {
    return undefined;
  }
}

export function removeLifetimeFiles(daemonProfilesDir: string, sessionName: string): void {
  for (const suffix of ['.activity', '.watchdog.log'])
    fs.rmSync(path.join(daemonProfilesDir, `${sessionName}${suffix}`), { force: true });
}

// ---- the watchdog process ----

export function startWatchdog(clientInfo: ClientInfo, sessionName: string, lifetime: Lifetime, daemonPid: number | undefined, sessionTimestamp: number): number | undefined {
  if (!lifetime.idleMs && !lifetime.ownerPid)
    return undefined;
  const args = [
    process.argv[1],
    watchdogCommand,
    `--session=${sessionName}`,
    `--idle-ms=${lifetime.idleMs}`,
    `--owner-pid=${lifetime.ownerPid ?? 0}`,
    `--daemon-pid=${daemonPid ?? 0}`,
    `--session-timestamp=${sessionTimestamp}`,
  ];
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(), // the same workspace as the daemon, so the registry resolves the same session
    env: process.env,
    windowsHide: true,
  });
  child.unref();
  updateState(clientInfo.daemonProfilesDir, sessionName, { watchdogPid: child.pid, lifetime: { idleMs: lifetime.idleMs, ownerPid: lifetime.ownerPid } });
  return child.pid;
}

export function stopWatchdog(clientInfo: ClientInfo, sessionName: string): void {
  const state = readState(clientInfo.daemonProfilesDir, sessionName);
  if (state.watchdogPid) {
    try {
      process.kill(state.watchdogPid);
    } catch {
      // already gone
    }
  }
  if (state.watchdogPid || state.lifetime)
    updateState(clientInfo.daemonProfilesDir, sessionName, { watchdogPid: undefined, lifetime: undefined });
}

export async function runWatchdog(args: MinimistArgs): Promise<void> {
  const sessionName = String(args.session);
  const idleMs = Number(args['idle-ms']) || 0;
  const ownerPid = Number(args['owner-pid']) || 0;
  const daemonPid = Number(args['daemon-pid']) || 0;
  const sessionTimestamp = Number(args['session-timestamp']) || 0;
  const intervalMs = Number(process.env.PATCHRIGHT_CLI_WATCHDOG_INTERVAL_MS) || 15_000;
  const clientInfo = createClientInfo();
  const logFile = path.join(clientInfo.daemonProfilesDir, `${sessionName}.watchdog.log`);
  const log = (line: string) => {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      // logging is best effort
    }
  };
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const startedAt = Date.now();
  log(`watching '${sessionName}': ${describeLifetime({ idleMs, ownerPid: ownerPid || undefined })}; daemon pid ${daemonPid || '?'}; poll every ${intervalMs} ms`);

  while (true) {
    await sleep(intervalMs);
    const registry = await Registry.load();
    const entry = registry.entry(clientInfo, sessionName);
    if (!entry || (sessionTimestamp && entry.config.timestamp !== sessionTimestamp)) {
      log('session closed or reopened; exiting');
      return;
    }
    if (daemonPid && !isProcessAlive(daemonPid)) {
      log('daemon process is gone; exiting');
      return;
    }
    const last = lastActivity(clientInfo.daemonProfilesDir, sessionName) ?? startedAt;
    let reason: string | undefined;
    if (idleMs && Date.now() - last >= idleMs)
      reason = `no command for ${describeDuration(idleMs)}`;
    else if (ownerPid && !isProcessAlive(ownerPid))
      reason = `owner process ${ownerPid} exited`;
    if (!reason)
      continue;
    log(`closing the browser: ${reason}`);
    try {
      const { wasOpen } = await new Session(entry).stop();
      log(wasOpen ? 'closed' : 'the daemon did not answer; left as is (patchright-cli kill-all cleans up)');
    } catch (e: any) {
      log(`stop failed: ${e.message}`);
    }
    return;
  }
}
