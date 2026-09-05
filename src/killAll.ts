/**
 * Copyright (c) Microsoft Corporation.
 * Modifications for patchright-cli (https://github.com/b1zya/patchright-cli).
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

// `kill-all`: terminates every daemon and dashboard process we spawned. Upstream matches
// any command line containing `cliDaemon.js`, which would also kill a playwright-cli
// running next to us; we additionally require the patchright-core package path.

import { execSync } from 'child_process';
import os from 'os';

export const corePackageMarker = 'patchright-core';
export const daemonScriptMarkers = ['cliDaemon.js', 'dashboardApp.js'];
// The hidden subcommand our session watchdogs run under (src/lifetime.ts). Matched together
// with its first argument, so a shell whose command text merely mentions the marker (a
// script grepping for it, a harness echoing this file) is not mistaken for a watchdog.
export const watchdogMarker = '__patchright-watchdog';
export const watchdogProcessMarker = `${watchdogMarker} --session=`;

export function matchDaemonProcess(commandLine: string): boolean {
  return (commandLine.includes(corePackageMarker) && daemonScriptMarkers.some(marker => commandLine.includes(marker)))
    || commandLine.includes(watchdogProcessMarker);
}

function pidFilterFromEnv(): Set<number> | undefined {
  const pidFilterEnv = process.env.PWTEST_KILL_ALL_PID_FILTER_FOR_TEST;
  if (!pidFilterEnv)
    return undefined;
  return new Set(pidFilterEnv.split(',').map(p => parseInt(p, 10)).filter(n => !isNaN(n)));
}

export async function killAllDaemons(): Promise<number[]> {
  const pidFilter = pidFilterFromEnv();
  const killed: number[] = [];

  try {
    if (os.platform() === 'win32') {
      const scriptClause = daemonScriptMarkers.map(p => `$_.CommandLine -like '*${p}*'`).join(' -or ');
      const clauses = [`((($_.CommandLine -like '*${corePackageMarker}*') -and (${scriptClause})) -or ($_.CommandLine -like '*${watchdogProcessMarker}*'))`];
      if (pidFilter)
        clauses.push(`(${[...pidFilter].map(p => `$_.ProcessId -eq ${p}`).join(' -or ')})`);
      const whereClause = clauses.join(' -and ');
      const result = execSync(
          `powershell -NoProfile -NonInteractive -Command `
          + `"Get-CimInstance Win32_Process `
          + `| Where-Object { ${whereClause} } `
          + `| ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }"`,
          { encoding: 'utf-8', windowsHide: true }
      );
      const pids = result.split('\n')
          .map(line => line.trim())
          .filter(line => /^\d+$/.test(line));
      for (const pid of pids)
        killed.push(parseInt(pid, 10));
    } else {
      const result = execSync('ps auxww', { encoding: 'utf-8', windowsHide: true });
      for (const line of result.split('\n')) {
        if (!matchDaemonProcess(line))
          continue;
        const pid = line.trim().split(/\s+/)[1];
        if (!pid || !/^\d+$/.test(pid))
          continue;
        const numericPid = parseInt(pid, 10);
        if (pidFilter && !pidFilter.has(numericPid))
          continue;
        try {
          process.kill(numericPid, 'SIGKILL');
          killed.push(numericPid);
        } catch {
          // Process may have already exited
        }
      }
    }
  } catch (e) {
    // Silently handle errors - no processes to kill is fine
  }
  return killed;
}
