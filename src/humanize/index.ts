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

// Turns the daemon's instant input commands into humanized `run-code` snippets when the
// session (or the individual command) asks for it. Opt-in: the daemon's own tools stay
// the default because a Bézier path over CDP input is slower and only partially closes
// the behavioral gap.

import crypto from 'crypto';

import { locatorExpression } from '../stealth/locator';
import { leak, notice } from '../stealth/warnings';
import { readState, updateState } from './state';
import { clickSnippet, dragSnippet, fillSnippet, hoverSnippet, moveSnippet, typeSnippet, wheelSnippet } from './snippets';

import type { MinimistArgs } from '../args';
import type { CommandContext, GuardResult } from '../stealth';
import type { Point } from './lib';
import type { Warning } from '../output';

export const humanizedCommands = ['click', 'dblclick', 'hover', 'drag', 'mousemove', 'mousewheel', 'type', 'fill'];

// Commands whose daemon tool returns a snapshot; we chain one so the output stays the same.
const snapshotAfter = new Set(['click', 'dblclick', 'hover', 'drag', 'type', 'fill']);

function list(value: MinimistArgs[string]): string[] | undefined {
  if (value === undefined || typeof value === 'boolean')
    return undefined;
  return Array.isArray(value) ? value : [value];
}

export function humanizeEnabled(args: MinimistArgs, ctx: CommandContext): boolean {
  if (args.humanize === false)
    return false;
  if (args.humanize === true)
    return true;
  return !!readState(ctx.clientInfo.daemonProfilesDir, ctx.sessionName).humanize;
}

export function buildSnippet(name: string, args: MinimistArgs, options: { seed: number, from?: Point }): string | undefined {
  const positional = args._.slice(1).map(String);
  switch (name) {
    case 'click':
    case 'dblclick': {
      if (!positional[0])
        return undefined;
      return clickSnippet(locatorExpression(positional[0]), { ...options, button: positional[1], modifiers: list(args.modifiers), double: name === 'dblclick' });
    }
    case 'hover':
      return positional[0] ? hoverSnippet(locatorExpression(positional[0]), options) : undefined;
    case 'drag':
      return positional[0] && positional[1] ? dragSnippet(locatorExpression(positional[0]), locatorExpression(positional[1]), options) : undefined;
    case 'mousemove': {
      const [x, y] = positional.map(Number);
      return Number.isFinite(x) && Number.isFinite(y) ? moveSnippet(x, y, options) : undefined;
    }
    case 'mousewheel': {
      const [dx, dy] = positional.map(Number);
      return Number.isFinite(dx) && Number.isFinite(dy) ? wheelSnippet(dx, dy, options) : undefined;
    }
    case 'type':
      return positional[0] !== undefined ? typeSnippet(positional[0], { ...options, submit: args.submit === true }) : undefined;
    case 'fill':
      return positional[0] && positional[1] !== undefined ? fillSnippet(locatorExpression(positional[0]), positional[1], { ...options, submit: args.submit === true }) : undefined;
    default:
      return undefined;
  }
}

export function humanizeRewrite(name: string, args: MinimistArgs, ctx: CommandContext): GuardResult | undefined {
  if (!humanizedCommands.includes(name) || !humanizeEnabled(args, ctx))
    return undefined;

  // The daemon resolves secret names to values; a humanized snippet would type the name.
  const text = name === 'type' ? args._[1] : name === 'fill' ? args._[2] : undefined;
  const secrets = (ctx.userConfig as any).secrets;
  if (typeof text === 'string' && secrets && typeof secrets === 'object' && text in secrets)
    return { kind: 'allow', warnings: [notice('humanize-secret', 'Secrets are typed by the daemon without humanization so the secret name is never typed literally.')] };

  const dir = ctx.clientInfo.daemonProfilesDir;
  const state = readState(dir, ctx.sessionName);
  const seed = crypto.randomInt(0, 2 ** 31);
  const code = buildSnippet(name, args, { seed, from: state.cursor });
  if (!code)
    return undefined;

  const warnings: Warning[] = [];
  if (!state.humanizeWarned) {
    warnings.push(leak('humanize-limits'));
    updateState(dir, ctx.sessionName, { humanizeWarned: true });
  }
  return {
    kind: 'rewrite',
    args: { _: ['run-code', code] },
    raw: true,
    silent: snapshotAfter.has(name),
    then: snapshotAfter.has(name) ? [{ _: ['snapshot'] }] : [],
    onResult: (result: string) => {
      try {
        const cursor = JSON.parse(result)?.cursor;
        if (cursor && typeof cursor.x === 'number' && typeof cursor.y === 'number')
          updateState(dir, ctx.sessionName, { cursor });
      } catch {
      }
    },
    warnings,
  };
}
