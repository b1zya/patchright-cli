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

// `wait-for-user [seconds]`: hand the visible browser window over to the person at the
// keyboard (a password the agent will not type, a one-time code, a consent dialog, a CAPTCHA
// they choose to pass themselves) and wait until the page navigates or the time runs out,
// then take a fresh snapshot. The wait is polled from the client, so no long-running daemon
// call is needed and the daemon's own action timeouts do not apply.
//
// The command refuses when nobody can see the window: a session launched with --headless, or
// a Linux host without a real display. Asking the user to type into a browser they cannot see
// is the failure this command exists to prevent, so it fails loudly instead of waiting quietly.

import { readState } from '../humanize/state';
import { detectDisplay } from './env';

import type { ClientCommand, CommandContext } from '../stealth';

export const defaultWaitSeconds = 300;
const pollIntervalMs = 2000;

export type WaitResult = { navigated: boolean, url: string, startUrl: string, waitedSeconds: number };

export type WaitForUserDeps = {
  sleep(ms: number): Promise<void>;
  isHeadless(ctx: CommandContext): boolean;
  displayProblem(): string | undefined;
};

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function parseSeconds(value: unknown): number {
  if (value === undefined)
    return defaultWaitSeconds;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error(`wait-for-user expects a positive number of seconds, got '${value}'`);
  return seconds;
}

// Same display detection as `env` and `open`: no display at all (a server, an SSH shell), or
// a display that xvfb-run provides, which is a virtual screen nobody looks at.
export function displayProblem(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const display = detectDisplay(platform, env);
  if (!display.available)
    return `No display a person can see (${display.detail}): the browser window is not on anyone's screen. Hand over only from a desktop session the user can see.`;
  if (!display.humanVisible)
    return `The display comes from xvfb, a virtual screen the user cannot see (${display.detail}). Hand over only from a desktop session the user can see.`;
  return undefined;
}

export function visibilityProblem(ctx: CommandContext, deps: Pick<WaitForUserDeps, 'isHeadless' | 'displayProblem'>): string | undefined {
  if (deps.isHeadless(ctx))
    return `Session '${ctx.sessionName}' is headless: the user cannot see the window, so there is nothing to hand over. Run 'patchright-cli -s=${ctx.sessionName} close', open it again without --headless (headed is the default), and only then ask the user to act.`;
  return deps.displayProblem();
}

async function currentUrl(ctx: CommandContext): Promise<string> {
  // Always text mode: in --json mode the daemon would wrap the value in its JSON envelope.
  const text = await ctx.runInSession({ _: ['eval', '() => location.href'] }, { raw: true, json: false });
  try {
    return String(JSON.parse(text));
  } catch {
    return text.trim();
  }
}

export async function waitForNavigation(ctx: CommandContext, seconds: number, sleep: (ms: number) => Promise<void> = defaultSleep): Promise<WaitResult> {
  const startUrl = await currentUrl(ctx);
  const deadline = Date.now() + seconds * 1000;
  const started = Date.now();
  while (Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    const url = await currentUrl(ctx);
    if (url !== startUrl)
      return { navigated: true, url, startUrl, waitedSeconds: Math.round((Date.now() - started) / 1000) };
  }
  return { navigated: false, url: startUrl, startUrl, waitedSeconds: seconds };
}

export const defaultDeps: WaitForUserDeps = {
  sleep: defaultSleep,
  isHeadless: ctx => readState(ctx.clientInfo.daemonProfilesDir, ctx.sessionName).headless === true,
  displayProblem: () => displayProblem(),
};

export function createWaitForUserCommand(deps: WaitForUserDeps = defaultDeps): ClientCommand {
  return {
    name: 'wait-for-user',
    async run(ctx) {
      const seconds = parseSeconds(ctx.args._[1]);
      const problem = visibilityProblem(ctx, deps);
      if (problem)
        throw new Error(problem);
      const result = await waitForNavigation(ctx, seconds, deps.sleep);
      const snapshot = await ctx.runInSession({ _: ['snapshot'] });
      if (ctx.output.json) {
        ctx.output.toolResult(JSON.stringify({ ...result, snapshot: tryJson(snapshot) }, null, 2));
        return;
      }
      const headline = result.navigated
        ? `### The user acted: page changed to ${result.url} after ${result.waitedSeconds}s`
        : `### No navigation within ${seconds}s; the page is still ${result.url}. Continue, or ask the user whether they need more time.`;
      ctx.output.toolResult(`${headline}\n${snapshot}`);
    },
  };
}

export const waitForUserCommand = createWaitForUserCommand();

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
