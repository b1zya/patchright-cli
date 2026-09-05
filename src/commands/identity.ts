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

// `identity`: what the session's persistent profile presents. Works whether or not the
// browser is open; falls back to the profile directories under the session registry.

import fs from 'fs';
import path from 'path';

import { readIdentity } from '../stealth/identity';

import type { Identity } from '../stealth/identity';
import type { ClientCommand, CommandContext } from '../stealth';

export function findProfileDirs(ctx: CommandContext): string[] {
  const entry = ctx.registry.entry(ctx.clientInfo, ctx.sessionName);
  const fromSession = entry?.config.browser?.userDataDir;
  if (fromSession)
    return [fromSession];
  try {
    return fs.readdirSync(ctx.clientInfo.daemonProfilesDir)
        .filter(name => name.startsWith(`ud-${ctx.sessionName}-`))
        .map(name => path.join(ctx.clientInfo.daemonProfilesDir, name));
  } catch {
    return [];
  }
}

export function renderIdentity(session: string, profileDir: string, identity: Identity | undefined): string {
  const lines = [`### Identity of session '${session}'`, `- profile: ${profileDir}`];
  if (!identity) {
    lines.push('- identity: (none yet; opened before patchright-cli tracked identities, or never opened)');
    return lines.join('\n');
  }
  lines.push(`- channel: ${identity.channel}`);
  lines.push(`- os: ${identity.os}`);
  lines.push(`- created: ${identity.createdAt}`);
  lines.push(`- last opened: ${identity.updatedAt}`);
  lines.push(`- locale: ${identity.locale ?? '(host default)'}`);
  lines.push(`- timezone: ${identity.timezone ?? '(host default)'}`);
  if (identity.geo)
    lines.push(`- geo: ${identity.geo.countryCode} via ${identity.geo.ip} (${identity.geo.source}, ${identity.geo.lookedUpAt})`);
  else
    lines.push('- geo: (no geoip lookup; no proxy)');
  return lines.join('\n');
}

export const identityCommand: ClientCommand = {
  name: 'identity',
  async run(ctx) {
    const dirs = findProfileDirs(ctx);
    if (!dirs.length) {
      ctx.output.toolResult(ctx.output.json
        ? JSON.stringify({ session: ctx.sessionName, profile: null, identity: null }, null, 2)
        : `Session '${ctx.sessionName}' has no persistent profile yet. Run \`patchright-cli${ctx.sessionName !== 'default' ? ` -s=${ctx.sessionName}` : ''} open\` first.`);
      return;
    }
    const profileDir = dirs[0];
    const identity = readIdentity(profileDir);
    ctx.output.toolResult(ctx.output.json
      ? JSON.stringify({ session: ctx.sessionName, profile: profileDir, identity: identity ?? null }, null, 2)
      : renderIdentity(ctx.sessionName, profileDir, identity));
  },
};
