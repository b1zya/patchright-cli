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

// Named profiles: `open --profile=work` keeps the identity (cookies, logins, history, the
// identity file) under the state root, so any session in any workspace can open it by name.
// A value with a path separator (`./work`, `/abs/dir`, `C:\dir`) is still a user data
// directory. Chrome lets one process at a time own a profile, so `open` refuses a profile a
// live session already holds instead of failing inside the browser.

import fs from 'fs';
import path from 'path';

import { namedProfilesDir } from '../paths';
import { Session } from '../session';
import { readIdentity } from '../stealth/identity';

import type { Registry, SessionFile } from '../registry';
import type { ClientCommand } from '../stealth';
import type { Identity } from '../stealth/identity';

const profileName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isProfileName(value: string): boolean {
  return profileName.test(value) && value !== '.' && value !== '..';
}

// `--profile` value -> user data directory.
export function resolveProfileDir(value: string, cwd: string): string {
  return isProfileName(value) ? path.join(namedProfilesDir(), value) : path.resolve(cwd, value);
}

function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
}

export type ProfileHolder = { session: string, workspace?: string, entry: SessionFile };

// Live sessions (any workspace) whose browser runs on this user data directory.
export async function profileHolders(registry: Registry, dir: string, alive: (entry: SessionFile) => Promise<boolean> = entry => new Session(entry).canConnect()): Promise<ProfileHolder[]> {
  const holders: ProfileHolder[] = [];
  for (const entries of registry.entryMap().values()) {
    for (const entry of entries) {
      const userDataDir = entry.config.browser?.userDataDir;
      if (userDataDir && sameDir(userDataDir, dir) && await alive(entry))
        holders.push({ session: entry.config.name, workspace: entry.config.workspaceDir, entry });
    }
  }
  return holders;
}

export function describeHolder(holder: ProfileHolder): string {
  return `session '${holder.session}'${holder.workspace ? ` (workspace ${holder.workspace})` : ''}`;
}

function sessionFlag(session: string): string {
  return session === 'default' ? '' : ` -s=${session}`;
}

// Called by `open` before anything is launched or written.
export async function assertProfileFree(registry: Registry, value: string, cwd: string, self: { session: string, daemonDir: string }): Promise<void> {
  const dir = resolveProfileDir(value, cwd);
  const others = (await profileHolders(registry, dir)).filter(h => !(h.session === self.session && sameDir(h.entry.daemonDir, self.daemonDir)));
  if (!others.length)
    return;
  const holder = others[0];
  const label = isProfileName(value) ? `Profile '${value}'` : `Profile directory ${dir}`;
  throw new Error(`${label} is in use by ${describeHolder(holder)}: Chrome runs one browser per profile. Work in that session (\`patchright-cli${sessionFlag(holder.session)} <command>\`), close it first (\`patchright-cli${sessionFlag(holder.session)} close\`), or pick another profile.`);
}

function dirSize(dir: string): number {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
        }
      }
    }
  }
  return total;
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024)
    return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export type NamedProfile = { name: string, dir: string, size: number, identity?: Identity, inUseBy?: string };

export async function listNamedProfiles(registry: Registry): Promise<NamedProfile[]> {
  const root = namedProfilesDir();
  let names: string[];
  try {
    names = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && isProfileName(e.name)).map(e => e.name).sort();
  } catch {
    return [];
  }
  const result: NamedProfile[] = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const holders = await profileHolders(registry, dir);
    result.push({ name, dir, size: dirSize(dir), identity: readIdentity(dir), inUseBy: holders[0] ? describeHolder(holders[0]) : undefined });
  }
  return result;
}

function renderProfile(profile: NamedProfile): string {
  const id = profile.identity;
  const facts = [
    formatSize(profile.size),
    id ? `${id.channel}, ${id.locale ?? 'host locale'}, ${id.timezone ?? 'host timezone'}${id.geo ? `, geo ${id.geo.countryCode}` : ''}` : 'never opened',
    id ? `last opened ${id.updatedAt}` : undefined,
    profile.inUseBy ? `in use by ${profile.inUseBy}` : 'idle',
  ].filter(Boolean);
  return `- ${profile.name}: ${facts.join('; ')}`;
}

export const profileListCommand: ClientCommand = {
  name: 'profile-list',
  async run(ctx) {
    const profiles = await listNamedProfiles(ctx.registry);
    if (ctx.output.json) {
      ctx.output.toolResult(JSON.stringify({ dir: namedProfilesDir(), profiles: profiles.map(p => ({ ...p, identity: p.identity ?? null, inUseBy: p.inUseBy ?? null })) }, null, 2));
      return;
    }
    if (!profiles.length) {
      ctx.output.toolResult(`No named profiles yet. \`patchright-cli open --profile=<name>\` creates one under ${namedProfilesDir()}.`);
      return;
    }
    ctx.output.toolResult([`### Named profiles (${namedProfilesDir()})`, ...profiles.map(renderProfile)].join('\n'));
  },
};

export const profileDeleteCommand: ClientCommand = {
  name: 'profile-delete',
  async run(ctx) {
    const name = ctx.args._[1];
    if (typeof name !== 'string' || !name)
      throw new Error('Usage: patchright-cli profile-delete <name> (see profile-list)');
    if (!isProfileName(name))
      throw new Error(`profile-delete takes a profile name, not a path: '${name}'. Delete a directory profile yourself.`);
    const dir = path.join(namedProfilesDir(), name);
    if (!fs.existsSync(dir))
      throw new Error(`No named profile '${name}'. See \`patchright-cli profile-list\`.`);
    const holders = await profileHolders(ctx.registry, dir);
    if (holders.length)
      throw new Error(`Profile '${name}' is in use by ${describeHolder(holders[0])}; close it first (\`patchright-cli${sessionFlag(holders[0].session)} close\`).`);
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    ctx.output.toolResult(ctx.output.json
      ? JSON.stringify({ deleted: name, dir }, null, 2)
      : `Deleted profile '${name}' (${dir}). The identity it carried (logins, cookies, history) is gone.`);
  },
};
