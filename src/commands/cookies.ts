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

// cookie-export / cookie-import: move cookies between this session and a file. Import reads
// what people actually have: a cookie-editor browser extension export (Cookie-Editor,
// EditThisCookie), a Netscape cookies.txt (curl, yt-dlp, "Get cookies.txt"), a Playwright
// storage state or a plain Playwright cookie array. Cookies are set with
// BrowserContext.addCookies (CDP, nothing the page can observe) and their values never appear
// in the output: run-code goes in raw mode, which prints only the returned count.

import fs from 'fs';
import path from 'path';

import { defaultOutputDir } from '../config/load';
import { runValue } from './pageShortcuts';

import type { ClientCommand } from '../stealth';

export type PlaywrightCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
};

function sameSite(value: unknown, secure: boolean): PlaywrightCookie['sameSite'] {
  const text = String(value ?? '').toLowerCase();
  if (text === 'strict')
    return 'Strict';
  if (text === 'none' || text === 'no_restriction')
    return secure ? 'None' : 'Lax';
  // 'lax', 'unspecified', missing: Chrome's default.
  return 'Lax';
}

function fromJsonCookie(raw: any): PlaywrightCookie {
  if (typeof raw?.name !== 'string' || typeof raw?.domain !== 'string')
    throw new Error('every cookie needs at least a name and a domain');
  const secure = raw.secure === true;
  // Extension exports: hostOnly cookies carry the bare host, the others a leading dot.
  let domain: string = raw.domain;
  if (raw.hostOnly === false && !domain.startsWith('.'))
    domain = '.' + domain;
  const expirySeconds = raw.expires ?? raw.expirationDate ?? raw.expiry;
  const session = raw.session === true || expirySeconds === undefined || expirySeconds === null || Number(expirySeconds) <= 0;
  return {
    name: raw.name,
    value: String(raw.value ?? ''),
    domain,
    path: typeof raw.path === 'string' && raw.path ? raw.path : '/',
    expires: session ? -1 : Math.floor(Number(expirySeconds)),
    httpOnly: raw.httpOnly === true,
    secure,
    sameSite: sameSite(raw.sameSite, secure),
  };
}

// Netscape format: domain, include-subdomains, path, secure, expiry, name, value (tab
// separated); "#HttpOnly_" prefixes an httpOnly cookie's domain.
function fromNetscape(text: string): PlaywrightCookie[] {
  const cookies: PlaywrightCookie[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    }
    if (!line.trim() || line.startsWith('#'))
      continue;
    const fields = line.split('\t');
    if (fields.length < 7)
      throw new Error(`not a cookies.txt line (expected 7 tab-separated fields): ${rawLine.slice(0, 80)}`);
    const [domain, , cookiePath, secureFlag, expiry, name, ...value] = fields;
    const secure = secureFlag.toUpperCase() === 'TRUE';
    const expires = Number(expiry);
    cookies.push({ name, value: value.join('\t'), domain, path: cookiePath || '/', expires: expires > 0 ? expires : -1, httpOnly, secure, sameSite: 'Lax' });
  }
  return cookies;
}

export function parseCookieFile(text: string): { cookies: PlaywrightCookie[], format: string } {
  const trimmed = text.replace(/^﻿/, '').trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (e: any) {
      throw new Error(`cookie file is not valid JSON: ${e.message}`);
    }
    if (Array.isArray(parsed))
      return { cookies: parsed.map(fromJsonCookie), format: parsed.some(c => 'expirationDate' in c || 'hostOnly' in c) ? 'browser extension JSON' : 'cookie JSON array' };
    if (Array.isArray(parsed?.cookies))
      return { cookies: parsed.cookies.map(fromJsonCookie), format: 'Playwright storage state' };
    throw new Error('JSON cookie file must be an array of cookies or a storage state with a "cookies" array');
  }
  return { cookies: fromNetscape(trimmed), format: 'Netscape cookies.txt' };
}

export function toNetscape(cookies: PlaywrightCookie[]): string {
  const lines = ['# Netscape HTTP Cookie File', '# Exported by patchright-cli', ''];
  for (const c of cookies) {
    const domain = (c.httpOnly ? '#HttpOnly_' : '') + c.domain;
    lines.push([domain, c.domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path, c.secure ? 'TRUE' : 'FALSE', String(c.expires > 0 ? Math.floor(c.expires) : 0), c.name, c.value].join('\t'));
  }
  return lines.join('\n') + '\n';
}

function matchesDomain(cookieDomain: string, filter: string): boolean {
  const host = cookieDomain.replace(/^\./, '').toLowerCase();
  const wanted = filter.replace(/^\./, '').toLowerCase();
  return host === wanted || host.endsWith('.' + wanted);
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export const cookieExportCommand: ClientCommand = {
  name: 'cookie-export',
  async run(ctx) {
    const format = typeof ctx.args.format === 'string' ? ctx.args.format : 'json';
    if (format !== 'json' && format !== 'netscape')
      throw new Error(`--format must be json or netscape, got '${format}'`);
    let cookies = await runValue(ctx, 'async page => await page.context().cookies()') as PlaywrightCookie[];
    const domain = ctx.args.domain;
    if (typeof domain === 'string' && domain)
      cookies = cookies.filter(c => matchesDomain(c.domain, domain));
    const given = ctx.args._[1];
    const file = typeof given === 'string' && given
      ? path.resolve(process.cwd(), given)
      : path.join(defaultOutputDir(ctx.clientInfo.workspaceDir, process.cwd()), `cookies-${timestamp()}.${format === 'json' ? 'json' : 'txt'}`);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    // Cookies are credentials: owner-only, like the daemon config.
    await fs.promises.writeFile(file, format === 'json' ? JSON.stringify(cookies, null, 2) + '\n' : toNetscape(cookies), { mode: 0o600 });
    ctx.output.toolResult(ctx.output.json
      ? JSON.stringify({ file, count: cookies.length, format }, null, 2)
      : `Exported ${cookies.length} cookie${cookies.length === 1 ? '' : 's'} to ${file} (${format}). The file holds live session credentials.`);
  },
};

export const cookieImportCommand: ClientCommand = {
  name: 'cookie-import',
  async run(ctx) {
    const given = ctx.args._[1];
    if (typeof given !== 'string' || !given)
      throw new Error('Usage: patchright-cli cookie-import <file> [--domain=example.com]');
    const file = path.resolve(process.cwd(), given);
    let text: string;
    try {
      text = await fs.promises.readFile(file, 'utf8');
    } catch (e: any) {
      throw new Error(`Cannot read ${file}: ${e.message}`);
    }
    const parsed = parseCookieFile(text);
    let cookies = parsed.cookies;
    const domain = ctx.args.domain;
    if (typeof domain === 'string' && domain)
      cookies = cookies.filter(c => matchesDomain(c.domain, domain));
    if (cookies.length) {
      const added = await runValue(ctx, `async page => { await page.context().addCookies(${JSON.stringify(cookies)}); return ${cookies.length}; }`);
      if (added !== cookies.length)
        throw new Error(`Unexpected result while adding cookies: ${String(added).slice(0, 200)}`);
    }
    const domains = [...new Set(cookies.map(c => c.domain.replace(/^\./, '')))];
    ctx.output.toolResult(ctx.output.json
      ? JSON.stringify({ file, format: parsed.format, count: cookies.length, domains }, null, 2)
      : `Imported ${cookies.length} cookie${cookies.length === 1 ? '' : 's'} from ${file} (${parsed.format})${domains.length ? ` for ${domains.slice(0, 8).join(', ')}${domains.length > 8 ? `, +${domains.length - 8} more` : ''}` : ''}. Reload or navigate for the site to see them.`);
  },
};

export const cookieFileCommands: ClientCommand[] = [cookieExportCommand, cookieImportCommand];
