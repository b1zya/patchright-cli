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

// The boundary between the generic client (parser, sessions, daemon protocol) and the
// anti-detection layer. program.ts calls exactly these hooks:
//   - resolveLaunchProfile: turns `open`/`attach` arguments + user config into the daemon
//     config file, daemon flags and environment for one browser launch;
//   - guardCommand: allow / rewrite / deny a command before it reaches the daemon;
//   - extraCommands: commands implemented on the client (console, config-print, identity, doctor);
//   - clientOnlyFlags: flags the daemon must never see (it rejects unknown options).

import { batchCommand } from '../commands/batch';
import { configPrintCommand } from '../commands/configPrint';
import { consoleCommand } from '../commands/console';
import { doctorCommand } from '../commands/doctor';
import { envCommand } from '../commands/env';
import { identityCommand } from '../commands/identity';
import { selftestCommand } from '../commands/selftest';
import { waitForUserCommand } from '../commands/waitForUser';
import { defaultOutputDir, toDaemonConfig } from '../config/load';
import { clientOnlyFlagNames } from './flags';
import { guardCommand } from './guards';
import { resolveLaunchProfile } from './launchProfile';

import type { MinimistArgs } from '../args';
import type { DaemonConfig, UserConfigLayer } from '../config/schema';
import type { Output, Warning } from '../output';
import type { ClientInfo, Registry } from '../registry';

export type DaemonFlags = {
  headed?: boolean;
  mobile?: boolean;
  device?: string;
  browser?: string;
  persistent?: boolean;
  profile?: string;
  cdp?: string;
  endpoint?: string;
  extension?: boolean;
};

export type LaunchRequest = {
  mode: 'open' | 'attach';
  sessionName: string;
  cwd: string;
  workspaceDir?: string;
  args: MinimistArgs;
  userConfig: UserConfigLayer;
  daemonProfilesDir: string;
};

// The facts of a launch an agent may need to quote: which browser and build, which mode,
// which profile, which user agent the page sees. `open` prints them once as one line (the
// executable path only when it is not a standard channel) and puts all of them into the
// JSON result as `launch`; nothing repeats them on later commands.
export type LaunchFacts = {
  channel: string;
  executablePath?: string;
  version?: string;
  headless: boolean;
  profileDir?: string;
  userAgent?: string;
  userAgentSource?: 'headless' | 'config';
};

export type LaunchProfile = {
  daemonConfig: DaemonConfig;
  daemonFlags: DaemonFlags;
  env?: Record<string, string>;
  warnings: Warning[];
  launch?: LaunchFacts;
};

export type GuardResult = (
  | { kind: 'allow' }
  | {
    kind: 'rewrite';
    args: MinimistArgs;
    raw?: boolean;
    // Do not print the rewritten command's own result (e.g. a pointer position).
    silent?: boolean;
    // Follow-up commands whose output is printed after the rewritten one (e.g. a snapshot).
    then?: MinimistArgs[];
    // Sees the rewritten command's raw result before anything is printed.
    onResult?: (text: string) => void;
  }
  | { kind: 'deny', message: string }
) & { warnings?: Warning[] };

export type CommandContext = {
  args: MinimistArgs;
  sessionName: string;
  clientInfo: ClientInfo;
  registry: Registry;
  output: Output;
  userConfig: UserConfigLayer;
  // Sends a command to the session's daemon; errors out if the browser is not open.
  runInSession(args: MinimistArgs, options?: { raw?: boolean, json?: boolean }): Promise<string>;
};

export type ClientCommand = {
  name: string;
  run(ctx: CommandContext): Promise<void>;
};

export interface StealthLayer {
  resolveLaunchProfile(request: LaunchRequest): Promise<LaunchProfile>;
  guardCommand(name: string, args: MinimistArgs, ctx: CommandContext): GuardResult;
  extraCommands: ClientCommand[];
  clientOnlyFlags: string[];
}

const daemonFlagKeys: (keyof DaemonFlags)[] = ['headed', 'mobile', 'device', 'browser', 'persistent', 'profile', 'cdp', 'endpoint', 'extension'];

export function daemonFlagsFromArgs(args: MinimistArgs): DaemonFlags {
  const flags: DaemonFlags = {};
  for (const key of daemonFlagKeys) {
    if (args[key] !== undefined && args[key] !== false)
      (flags as any)[key] = args[key];
  }
  return flags;
}

// Upstream-equivalent behavior: flags go to the daemon as given, the user config becomes
// the daemon config, nothing is guarded. Kept for tests and as a reference point.
export const noopStealth: StealthLayer = {
  async resolveLaunchProfile(request: LaunchRequest): Promise<LaunchProfile> {
    return {
      daemonConfig: toDaemonConfig(request.userConfig, { outputDir: defaultOutputDir(request.workspaceDir, request.cwd) }),
      daemonFlags: daemonFlagsFromArgs(request.args),
      warnings: [],
    };
  },
  guardCommand(): GuardResult {
    return { kind: 'allow' };
  },
  extraCommands: [],
  clientOnlyFlags: [],
};

export const stealth: StealthLayer = {
  resolveLaunchProfile,
  guardCommand,
  extraCommands: [consoleCommand, configPrintCommand, identityCommand, doctorCommand, selftestCommand, envCommand, batchCommand, waitForUserCommand],
  clientOnlyFlags: clientOnlyFlagNames,
};
