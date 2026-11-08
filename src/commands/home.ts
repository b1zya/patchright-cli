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

// The home view: what a bare `patchright-cli` prints instead of the manual (that is `--help`).
// An agent arriving in a workspace learns in a few lines which browsers are already open here,
// what each one shows and what to run next, so it continues a session instead of opening a
// second one. It is read-only and quick: it starts nothing, deletes no stale session file,
// does not count as activity for a session's idle timer, and gives each daemon a short budget.

import path from 'path';

import { readState } from '../humanize/state';
import { describeLifetime } from '../lifetime';
import { namedProfilesDir } from '../paths';
import { clientKey } from '../registry';
import { Session } from '../session';

import type { ClientInfo, Registry, SessionFile } from '../registry';

export type HomeTab = { index: number, title: string, url: string };

export type HomeSession = {
  name: string;
  // open: answered `tab-list`; busy: did not answer in time; incompatible: started by a newer
  // client than this one, which refuses to drive it (`open` restarts it).
  status: 'open' | 'busy' | 'incompatible';
  headed?: boolean;
  attached: boolean;
  browser?: string;
  // The named profile (`open --profile=<name>`) the session runs on, if any.
  profile?: string;
  tabs?: number;
  current?: HomeTab;
  lifetime?: string;
};

export type HomeHint = { command: string, why: string };

export type HomeData = {
  version: string;
  core: string;
  workspace: string | null;
  skill?: string;
  sessions: HomeSession[];
  next: HomeHint[];
};

// One daemon gets this long to answer `tab-list`; all of them are asked at once.
export const homeProbeTimeoutMs = 1500;

// `- 1: (current) [Title](https://example.com/)`, as the daemon's raw tab-list prints it.
const tabLine = /^- (\d+): (\(current\) )?\[(.*)\]\((.*)\)$/;

export function parseTabList(text: string): { tabs: number, current?: HomeTab } {
  let tabs = 0;
  let current: HomeTab | undefined;
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(tabLine);
    if (!match)
      continue;
    tabs++;
    if (match[2])
      current = { index: Number(match[1]), title: match[3], url: match[4] };
  }
  return { tabs, current };
}

function profileOf(userDataDir: string | undefined): string | undefined {
  if (!userDataDir)
    return undefined;
  const relative = path.relative(namedProfilesDir(), userDataDir);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.includes(path.sep) ? relative : undefined;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms); });
  return Promise.race([promise.catch(() => undefined), timeout]).finally(() => clearTimeout(timer));
}

export type HomeProbe = (entry: SessionFile) => Promise<{ alive: boolean, tabList?: string }>;

// Connects to the daemon and asks for its tabs. A daemon that does not accept the connection
// is gone (its session file is stale); one that accepts but does not answer in time is busy.
export function daemonProbe(clientInfo: ClientInfo, timeoutMs = homeProbeTimeoutMs): HomeProbe {
  return async entry => {
    const session = new Session(entry);
    if (!await withTimeout(session.canConnect(), timeoutMs))
      return { alive: false };
    if (!session.isCompatible(clientInfo))
      return { alive: true };
    const result = await withTimeout(session.run(clientInfo, { _: ['tab-list'] }, { raw: true }), timeoutMs);
    return { alive: true, tabList: result && !result.isError ? result.text : undefined };
  };
}

export async function collectHomeSessions(registry: Registry, clientInfo: ClientInfo, probe: HomeProbe): Promise<HomeSession[]> {
  const entries = registry.entryMap().get(clientKey(clientInfo)) ?? [];
  const sessions = await Promise.all(entries.map(async (entry): Promise<HomeSession | undefined> => {
    const { alive, tabList } = await probe(entry);
    if (!alive)
      return undefined;
    const config = entry.config;
    const compatible = new Session(entry).isCompatible(clientInfo);
    const lifetime = readState(entry.daemonDir, config.name).lifetime;
    const session: HomeSession = {
      name: config.name,
      status: !compatible ? 'incompatible' : tabList === undefined ? 'busy' : 'open',
      headed: config.browser ? !config.browser.launchOptions.headless : undefined,
      attached: !!config.attached,
      browser: config.browser?.launchOptions.channel ?? config.browser?.browserName,
      profile: profileOf(config.browser?.userDataDir),
      lifetime: lifetime ? describeLifetime(lifetime) : undefined,
    };
    if (tabList !== undefined)
      Object.assign(session, parseTabList(tabList));
    return session;
  }));
  return sessions.filter((s): s is HomeSession => !!s).sort((a, b) => a.name === 'default' ? -1 : b.name === 'default' ? 1 : a.name.localeCompare(b.name));
}

function sessionFlag(name: string): string {
  return name === 'default' ? '' : ` -s=${name}`;
}

export function homeHints(sessions: HomeSession[]): HomeHint[] {
  const hints: HomeHint[] = [];
  const first = sessions.find(s => s.status === 'open');
  if (first) {
    hints.push({ command: `patchright-cli${sessionFlag(first.name)} snapshot`, why: 'element refs of the current page' });
    if (sessions.length > 1)
      hints.push({ command: 'patchright-cli -s=<name> <command>', why: 'act in another session' });
  } else if (!sessions.length) {
    hints.push({ command: 'patchright-cli open <url>', why: 'headless Chrome with this workspace\'s identity; --headed for a window' });
    hints.push({ command: 'patchright-cli env', why: 'shell quoting, display and rules for this machine' });
  }
  const incompatible = sessions.find(s => s.status === 'incompatible');
  if (incompatible)
    hints.push({ command: `patchright-cli${sessionFlag(incompatible.name)} open`, why: `restart '${incompatible.name}', started by a newer patchright-cli` });
  hints.push({ command: 'patchright-cli list --all', why: 'sessions in every workspace' });
  hints.push({ command: 'patchright-cli --help', why: 'all commands; <command> --help for one' });
  return hints;
}

const maxUrl = 80;

function shorten(text: string, max: number): string {
  // ASCII on purpose: a legacy Windows console code page has no ellipsis.
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

function describeSession(session: HomeSession): string[] {
  const parts: string[] = [];
  if (session.attached)
    parts.push(`attached ${session.browser ?? 'browser'}`);
  else
    parts.push(`${session.headed ? 'headed' : 'headless'} ${session.browser ?? 'chrome'}`);
  if (session.profile)
    parts.push(`profile ${session.profile}`);
  if (session.status === 'incompatible') {
    parts.push('started by a newer patchright-cli; open restarts it');
  } else if (session.status === 'busy') {
    parts.push(`busy (no answer within ${homeProbeTimeoutMs / 1000} s)`);
  } else {
    parts.push(`${session.tabs} tab${session.tabs === 1 ? '' : 's'}`);
    if (session.current) {
      const title = session.current.title ? ` "${shorten(session.current.title, 60)}"` : '';
      parts.push(`current${title} ${shorten(session.current.url, maxUrl)}`);
    }
  }
  const lines = [`- ${session.name}: ${parts.join(', ')}`];
  if (session.lifetime)
    lines.push(`  ${session.lifetime}`);
  return lines;
}

export function renderHome(data: HomeData): string {
  const lines = [`patchright-cli ${data.version} (patchright-core ${data.core}) - anti-detection browser automation for AI agents`];
  if (data.skill)
    lines.push(`Agent skill: ${data.skill}`);
  lines.push('');
  if (data.sessions.length) {
    lines.push(`Browsers open in this workspace (${data.sessions.length}):`);
    for (const session of data.sessions)
      lines.push(...describeSession(session));
  } else {
    lines.push('No browser open in this workspace.');
  }
  lines.push('', 'Next:');
  const width = Math.max(...data.next.map(h => h.command.length));
  for (const hint of data.next)
    lines.push(`  ${hint.command.padEnd(width)}  ${hint.why}`);
  return lines.join('\n');
}

export async function collectHome(options: { registry: Registry, clientInfo: ClientInfo, version: string, core: string, skill?: string, probe?: HomeProbe }): Promise<HomeData> {
  const sessions = await collectHomeSessions(options.registry, options.clientInfo, options.probe ?? daemonProbe(options.clientInfo));
  return {
    version: options.version,
    core: options.core,
    workspace: options.clientInfo.workspaceDir ?? null,
    skill: options.skill,
    sessions,
    next: homeHints(sessions),
  };
}
