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

// Forked from playwright-core/src/tools/cli-client/registry.ts (v1.62.1).
// The workspace hash and the daemon profiles dir must match what the daemon computes
// on its side (patchright-core lib/coreBundle.js createClientInfo), so the inputs are
// the same: the `.playwright` workspace marker and the core package root.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { coreRoot, coreVersion } from './core';
import { daemonRoot, env, workspaceMarker } from './paths';

import type { LaunchOptions } from 'patchright-core';

export type ClientInfo = {
  version: string;
  workspaceDirHash: string;
  daemonProfilesDir: string;
  workspaceDir: string | undefined;
  homeDir: string;
};

export function clientKey(clientInfo: ClientInfo): string {
  return clientInfo.workspaceDir || clientInfo.workspaceDirHash;
}

export type SessionConfig = {
  name: string;
  version: string;
  timestamp: number;
  socketPath: string;
  attached?: boolean;
  cli: {
    persistent?: boolean;
  };
  workspaceDir?: string;
  browser: {
    browserName: string;
    launchOptions: LaunchOptions;
    userDataDir?: string;
  };
};

export type SessionFile = {
  file: string;
  daemonDir: string;
  config: SessionConfig;
};

export class Registry {
  private _files: Map<string, SessionFile[]>;

  private constructor(files: Map<string, SessionFile[]>) {
    this._files = files;
  }

  entry(clientInfo: ClientInfo, sessionName: string): SessionFile | undefined {
    const key = clientKey(clientInfo);
    const entries = this._files.get(key) || [];
    return entries.find(entry => entry.config.name === sessionName);
  }

  entries(clientInfo: ClientInfo): SessionFile[] {
    return this._files.get(clientKey(clientInfo)) || [];
  }

  entryMap(): Map<string, SessionFile[]> {
    return this._files;
  }

  async loadEntry(clientInfo: ClientInfo, sessionName: string): Promise<SessionFile> {
    const entry = await Registry._loadSessionEntry(clientInfo.daemonProfilesDir, sessionName + '.session');
    if (!entry)
      throw new Error(`Could not start the session "${sessionName}"`);

    const key = clientKey(clientInfo);
    let list = this._files.get(key);
    if (!list) {
      list = [];
      this._files.set(key, list);
    }
    const oldIndex = list.findIndex(e => e.config.name === sessionName);
    if (oldIndex !== -1)
      list.splice(oldIndex, 1);
    list.push(entry);
    return entry;
  }

  private static async _loadSessionEntry(daemonDir: string, file: string): Promise<SessionFile | undefined> {
    try {
      const fileName = path.join(daemonDir, file);
      const data = await fs.promises.readFile(fileName, 'utf-8');
      const config = JSON.parse(data) as SessionConfig;
      // Sessions from 0.1.0 support.
      if (!config.name)
        config.name = path.basename(file, '.session');
      if (!config.timestamp)
        config.timestamp = 0;
      return { file: fileName, config, daemonDir };
    } catch {
      return undefined;
    }
  }

  static async load(): Promise<Registry> {
    const sessions = new Map<string, SessionFile[]>();
    const root = baseDaemonDir();
    const hashDirs = await fs.promises.readdir(root).catch(() => []);
    for (const workspaceDirHash of hashDirs) {
      const daemonDir = path.join(root, workspaceDirHash);
      const stat = await fs.promises.stat(daemonDir);
      if (!stat.isDirectory())
        continue;

      const files = await fs.promises.readdir(daemonDir).catch(() => []);
      for (const file of files) {
        if (!file.endsWith('.session'))
          continue;
        const entry = await Registry._loadSessionEntry(daemonDir, file);
        if (!entry)
          continue;
        const key = entry.config.workspaceDir || workspaceDirHash;
        let list = sessions.get(key);
        if (!list) {
          list = [];
          sessions.set(key, list);
        }
        list.push(entry);
      }
    }
    return new Registry(sessions);
  }
}

// The daemon is pointed at the same directory through PWTEST_DAEMON_SESSION_DIR (daemonEnv.ts).
export function baseDaemonDir(): string {
  return daemonRoot();
}

export function createClientInfo(): ClientInfo {
  const workspaceDir = findWorkspaceDir(process.cwd());
  // The daemon reports the patchright-core version and rejects clients that are older,
  // so the client identifies itself with the core version, not the CLI package version.
  const version = process.env[env.versionForTest] || coreVersion;

  const hash = crypto.createHash('sha1');
  hash.update(workspaceDir || coreRoot);
  const workspaceDirHash = hash.digest('hex').substring(0, 16);

  return {
    version,
    workspaceDir,
    workspaceDirHash,
    daemonProfilesDir: daemonProfilesDir(workspaceDirHash),
    homeDir: os.homedir(),
  };
}

export function findWorkspaceDir(startDir: string): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, workspaceMarker)))
      return dir;
    const parentDir = path.dirname(dir);
    if (parentDir === dir)
      break;
    dir = parentDir;
  }
  return undefined;
}

const daemonProfilesDir = (workspaceDirHash: string) => {
  return path.join(baseDaemonDir(), workspaceDirHash);
};

export function explicitSessionName(sessionName?: string): string | undefined {
  return sessionName || process.env[env.session];
}

export function resolveSessionName(sessionName?: string): string {
  return explicitSessionName(sessionName) || 'default';
}
