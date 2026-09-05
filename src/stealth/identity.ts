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

// One persistent profile = one identity. Chromium has no fingerprint generator to freeze,
// so the identity is the profile itself plus the geo-derived values it was last opened
// with. Frozen: channel and host OS (changing them on a warm profile is a signal).
// Refreshed on every open: locale and proxy-derived geo. Never stored: the proxy.

import fs from 'fs';
import os from 'os';
import path from 'path';

import { leak } from './warnings';

import type { GeoInfo } from './geo';
import type { Warning } from '../output';

export const identityFileName = 'patchright-cli.json';

export type Identity = {
  version: 1;
  createdAt: string;
  updatedAt: string;
  channel: string;
  os: string;
  locale?: string;
  timezone?: string;
  geo?: GeoInfo;
};

export type IdentityInput = {
  channel: string;
  locale?: string;
  timezone?: string;
  geo?: GeoInfo;
};

export function identityFile(profileDir: string): string {
  return path.join(profileDir, identityFileName);
}

export function readIdentity(profileDir: string): Identity | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(identityFile(profileDir), 'utf8'));
    if (parsed && parsed.version === 1 && typeof parsed.channel === 'string')
      return parsed as Identity;
  } catch {
  }
  return undefined;
}

export function writeIdentity(profileDir: string, identity: Identity): void {
  fs.mkdirSync(profileDir, { recursive: true });
  fs.writeFileSync(identityFile(profileDir), JSON.stringify(identity, null, 2) + '\n');
}

export function reconcileIdentity(existing: Identity | undefined, input: IdentityInput, now = new Date()): { identity: Identity, warnings: Warning[] } {
  const warnings: Warning[] = [];
  const timestamp = now.toISOString();
  if (!existing) {
    return {
      identity: {
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        channel: input.channel,
        os: `${os.platform()} ${os.release()}`,
        locale: input.locale,
        timezone: input.timezone,
        geo: input.geo,
      },
      warnings,
    };
  }
  if (existing.channel !== input.channel)
    warnings.push(leak('channel-changed', `${existing.channel} -> ${input.channel}`));
  return {
    identity: {
      ...existing,
      updatedAt: timestamp,
      channel: input.channel,
      locale: input.locale ?? existing.locale,
      timezone: input.timezone ?? existing.timezone,
      geo: input.geo ?? existing.geo,
    },
    warnings,
  };
}
