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

// Small reads and waits an agent otherwise writes as eval/run-code every time: url, title,
// text, wait, wait-for, scroll-to. Each one is a fixed Playwright snippet sent through
// run-code in raw mode, so it goes through patchright like any other command (element reads
// in the isolated world, no page globals touched) and prints just the value.

import { locatorExpression } from '../stealth/locator';

import type { ClientCommand, CommandContext } from '../stealth';

const ansi = /\x1b\[[0-9;]*m/g;

// Runs a page function in the session and returns its JSON value; a daemon error is thrown.
export async function runValue(ctx: CommandContext, code: string): Promise<unknown> {
  const text = await ctx.runInSession({ _: ['run-code', code] }, { raw: true, json: false });
  if (text.startsWith('### Error')) {
    throw new Error(text.replace(/^### Error\n/, '').replace(ansi, '').trim());
  }
  try {
    return JSON.parse(text);
  } catch {
    return text.trim();
  }
}

function print(ctx: CommandContext, key: string, value: unknown, text: string) {
  ctx.output.toolResult(ctx.output.json ? JSON.stringify({ [key]: value }, null, 2) : text);
}

function target(ctx: CommandContext, usage: string): string {
  const value = ctx.args._[1];
  if (typeof value !== 'string' || !value)
    throw new Error(`Usage: patchright-cli ${usage}`);
  return value;
}

// Milliseconds, as Playwright counts them; 0 means no limit.
export function parseTimeout(value: unknown, fallback = 30_000): number {
  if (value === undefined || value === true)
    return fallback;
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0)
    throw new Error(`--timeout expects milliseconds (0 = no limit), got '${value}'`);
  return ms;
}

export const waitStates = ['visible', 'hidden', 'attached', 'detached'] as const;

export function textCode(selector: string | undefined, maxChars: number | undefined): string {
  const receiver = selector ? locatorExpression(selector) : `page.locator('body')`;
  const limit = maxChars ? `.slice(0, ${maxChars})` : '';
  return `async page => (await ${receiver}.innerText())${limit}`;
}

export function waitUrlCode(pattern: string, timeout: number): string {
  return `async page => { await page.waitForURL(${JSON.stringify(pattern)}, { timeout: ${timeout} }); return page.url(); }`;
}

export function waitForCode(selector: string, state: string, timeout: number): string {
  return `async page => { await ${locatorExpression(selector)}.waitFor({ state: ${JSON.stringify(state)}, timeout: ${timeout} }); return ${JSON.stringify(state)}; }`;
}

export function scrollToCode(selector: string): string {
  return `async page => { const target = ${locatorExpression(selector)}; await target.scrollIntoViewIfNeeded(); return await target.evaluate(el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }); }`;
}

export const urlCommand: ClientCommand = {
  name: 'url',
  async run(ctx) {
    const url = String(await runValue(ctx, 'async page => page.url()'));
    print(ctx, 'url', url, url);
  },
};

export const titleCommand: ClientCommand = {
  name: 'title',
  async run(ctx) {
    const title = String(await runValue(ctx, 'async page => page.title()'));
    print(ctx, 'title', title, title);
  },
};

export const textCommand: ClientCommand = {
  name: 'text',
  async run(ctx) {
    const selector = typeof ctx.args._[1] === 'string' && ctx.args._[1] ? ctx.args._[1] : undefined;
    const max = ctx.args['max-chars'];
    const maxChars = max === undefined ? undefined : Number(max);
    if (maxChars !== undefined && (!Number.isInteger(maxChars) || maxChars <= 0))
      throw new Error(`--max-chars expects a positive integer, got '${max}'`);
    const text = String(await runValue(ctx, textCode(selector, maxChars)));
    print(ctx, 'text', text, text);
  },
};

export const waitCommand: ClientCommand = {
  name: 'wait',
  async run(ctx) {
    const url = ctx.args.url;
    const ms = ctx.args._[1];
    if (typeof url === 'string' && url) {
      if (ms !== undefined)
        throw new Error('wait takes either milliseconds or --url=<pattern>, not both');
      const reached = String(await runValue(ctx, waitUrlCode(url, parseTimeout(ctx.args.timeout))));
      print(ctx, 'url', reached, `URL matches ${url}: ${reached}`);
      return;
    }
    const delay = Number(ms);
    if (ms === undefined || !Number.isFinite(delay) || delay < 0)
      throw new Error('Usage: patchright-cli wait <milliseconds> | wait --url=<pattern>');
    // A plain pause needs no browser round trip; the session must still exist.
    if (!ctx.registry.entry(ctx.clientInfo, ctx.sessionName))
      ctx.output.errorBrowserNotOpenForTool(ctx.sessionName);
    await new Promise(resolve => setTimeout(resolve, delay));
    print(ctx, 'waited', delay, `Waited ${delay}ms`);
  },
};

export const waitForCommand: ClientCommand = {
  name: 'wait-for',
  async run(ctx) {
    const selector = target(ctx, 'wait-for <target> [--state=visible|hidden|attached|detached] [--timeout=ms]');
    const state = typeof ctx.args.state === 'string' ? ctx.args.state : 'visible';
    if (!(waitStates as readonly string[]).includes(state))
      throw new Error(`--state must be one of ${waitStates.join(', ')}, got '${state}'`);
    await runValue(ctx, waitForCode(selector, state, parseTimeout(ctx.args.timeout)));
    print(ctx, 'state', state, `${selector} is ${state}`);
  },
};

export const scrollToCommand: ClientCommand = {
  name: 'scroll-to',
  async run(ctx) {
    const selector = target(ctx, 'scroll-to <target>');
    const box = await runValue(ctx, scrollToCode(selector)) as { x: number, y: number, width: number, height: number };
    print(ctx, 'box', box, `Scrolled ${selector} into view at x=${box.x} y=${box.y} (${box.width}x${box.height})`);
  },
};

export const pageShortcutCommands: ClientCommand[] = [urlCommand, titleCommand, textCommand, waitCommand, waitForCommand, scrollToCommand];
