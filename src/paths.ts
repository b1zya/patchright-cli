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

// Single source of truth for product names, on-disk locations and environment
// variable names. Everything under stateRoot() is ours; nothing is shared with a
// playwright-cli installed side by side (see daemonEnv.ts for how the daemon is
// pointed at these directories).

import crypto from 'crypto';
import os from 'os';
import path from 'path';

import { packageRoot } from './core';

export const productName = 'patchright-cli';
export const skillName = 'patchright-cli';
// The daemon looks for this marker to find the workspace root; it cannot be renamed.
export const workspaceMarker = '.playwright';
// Where snapshots, screenshots and other command output go, relative to the workspace.
export const outputDirName = '.patchright-cli';

export const env = {
  home: 'PATCHRIGHT_CLI_HOME',
  session: 'PATCHRIGHT_CLI_SESSION',
  config: 'PATCHRIGHT_CLI_CONFIG',
  quietWarnings: 'PATCHRIGHT_CLI_QUIET_WARNINGS',
  updateUrlForTest: 'PATCHRIGHT_CLI_UPDATE_URL_FOR_TEST',
  // Shared with the daemon on purpose: it reports this as its own version.
  versionForTest: 'PLAYWRIGHT_CLI_VERSION_FOR_TEST',
} as const;

// Per-user cache directory, following the same platform conventions as playwright-core.
export function cacheDir(): string {
  let localCacheDir: string | undefined;
  if (process.platform === 'linux')
    localCacheDir = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  if (process.platform === 'darwin')
    localCacheDir = path.join(os.homedir(), 'Library', 'Caches');
  if (process.platform === 'win32')
    localCacheDir = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  if (!localCacheDir)
    throw new Error('Unsupported platform: ' + process.platform);
  return localCacheDir;
}

export function stateRoot(): string {
  return process.env[env.home] || path.join(cacheDir(), productName);
}

// Session registry: <daemonRoot>/<workspaceDirHash>/{<name>.session,<name>.err,ud-<name>-<channel>/}
export function daemonRoot(): string {
  return path.join(stateRoot(), 'daemon');
}

// Browser servers registered for `attach <name>` / `list --all`.
export function serverRegistryDir(): string {
  return path.join(stateRoot(), 'b');
}

// MCP profiles dir fallback (the CLI path always sets userDataDir, so rarely used).
export function profilesDir(): string {
  return path.join(stateRoot(), 'profiles');
}

// A home-dir substitute with no `.playwright/cli.config.json`, so the daemon does not
// merge the global config of a playwright-cli installed on the same machine.
export function noGlobalConfigDir(): string {
  return path.join(stateRoot(), 'noglobal');
}

export function updateCheckFile(): string {
  return path.join(stateRoot(), 'cli-update-check.json');
}

// Daemon sockets / named pipes. Unix sockets have a ~100 char path limit, so this stays
// under tmpdir rather than under stateRoot(); the name is still derived from the state
// root so that two installs (or two test runs) with different roots never share a socket.
export function socketsDir(): string {
  const userName = process.env.USERNAME || process.env.USER || 'default';
  const hash = crypto.createHash('sha1').update(`${userName}|${stateRoot()}`).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), `${productName}-${hash}`);
}

export function bundledSkillDir(): string {
  return path.join(packageRoot, 'skills', skillName);
}

export type SkillTarget = 'claude' | 'agents';

export function parseSkillTarget(value: unknown): SkillTarget {
  if (value === true || value === 'claude' || value === undefined)
    return 'claude';
  if (value === 'agents')
    return 'agents';
  throw new Error(`Unknown skills target '${value}'; use --skills or --skills=agents`);
}

export function skillInstallDir(target: SkillTarget, root: string): string {
  return path.join(root, target === 'agents' ? '.agents' : '.claude', 'skills', skillName);
}

export function skillInstallCommand(target: SkillTarget, global = false): string {
  return `${productName} install ${target === 'agents' ? '--skills=agents' : '--skills'}${global ? ' --global' : ''}`;
}
