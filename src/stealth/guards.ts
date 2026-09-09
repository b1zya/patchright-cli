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

// Per-command policy applied before a command reaches the daemon. Verified against
// patchright-core 1.62.3: `unroute` only removes the daemon's own routes (patchright's
// init-script route survives), so it is allowed; the only way to break the stealth
// route is `unrouteAll()` inside run-code, which is refused here.

import fs from 'fs';

import { humanizeRewrite } from '../humanize';
import { locatorExpression } from './locator';
import { leak, notice } from './warnings';

import type { MinimistArgs } from '../args';
import type { CommandContext, GuardResult } from './index';
import type { Warning } from '../output';

export { locatorExpression } from './locator';

// The daemon's eval accepts either a function (`() => ...`, `el => ...`) or a bare expression
// (`document.title`). A function source can be embedded as code; a bare expression must be
// handed to evaluate() as a string, otherwise it would run in the daemon's Node context.
const functionSource = /^\s*(async\s+)?(\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|function\b)/;

export function isFunctionSource(expression: string): boolean {
  return functionSource.test(expression);
}

// eval --main-world: patchright evaluates in an isolated world by default; the fourth
// argument of evaluate() selects the page main world.
export function mainWorldEvalCode(expression: string, target?: string): string {
  const receiver = target ? locatorExpression(target) : 'page';
  const pageFunction = isFunctionSource(expression) ? expression : JSON.stringify(expression);
  return `async page => {\n  return await ${receiver}.evaluate(${pageFunction}, undefined, undefined, false);\n}`;
}

// resize in a headed session: change the real window instead of emulating a viewport.
export function windowResizeCode(width: number, height: number): string {
  return [
    'async page => {',
    '  const cdp = await page.context().newCDPSession(page);',
    '  try {',
    `    const { windowId } = await cdp.send('Browser.getWindowForTarget');`,
    `    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });`,
    `    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { width: ${width}, height: ${height} } });`,
    '  } finally {',
    '    await cdp.detach().catch(() => {});',
    '  }',
    `  return { width: ${width}, height: ${height} };`,
    '}',
  ].join('\n');
}

const denyPatterns: { pattern: RegExp, message: string, forceable: boolean }[] = [
  { pattern: /\bunrouteAll\s*\(/, message: 'unrouteAll() removes the route patchright uses to inject init scripts; unroute specific patterns instead', forceable: true },
  { pattern: /Runtime\.enable\b/, message: 'Runtime.enable is the CDP leak patchright removes; it must never be re-enabled', forceable: false },
  { pattern: /--enable-automation\b/, message: '--enable-automation flags the browser as automated', forceable: true },
];

const warnPatterns: { pattern: RegExp, warning: () => Warning }[] = [
  { pattern: /\b(addInitScript|exposeFunction|exposeBinding|clock\.install)\s*\(/, warning: () => leak('init-script-route') },
  { pattern: /\b(setViewportSize|setUserAgent|setExtraHTTPHeaders)\s*\(|\bEmulation\./, warning: () => leak('run-code-emulation') },
];

export function scanRunCode(code: string, force: boolean): { denied?: string, warnings: Warning[] } {
  for (const { pattern, message, forceable } of denyPatterns) {
    if (pattern.test(code) && !(force && forceable))
      return { denied: `Refusing to run this code: ${message}.${forceable ? ' Pass --force to override.' : ''}`, warnings: [] };
  }
  return { warnings: warnPatterns.filter(({ pattern }) => pattern.test(code)).map(({ warning }) => warning()) };
}

function runCodeSource(args: MinimistArgs, cwd: string): string {
  const inline = args._[1];
  if (typeof inline === 'string' && inline)
    return inline;
  const file = args.filename;
  if (typeof file === 'string' && file) {
    try {
      return fs.readFileSync(require('path').resolve(cwd, file), 'utf8');
    } catch {
      return '';
    }
  }
  return '';
}

function sessionIsHeaded(ctx: CommandContext): boolean | undefined {
  const entry = ctx.registry.entry(ctx.clientInfo, ctx.sessionName);
  const headless = entry?.config.browser?.launchOptions?.headless;
  return headless === undefined ? undefined : !headless;
}

// Git Bash (MSYS) rewrites arguments that start with "/" into Windows paths before the
// CLI sees them: `find --regex "/sign in/i"` arrives as `C:/Program Files/Git/sign in/i`.
// The daemon would then search for that literal path. Warn so the agent can rerun with
// MSYS_NO_PATHCONV=1 instead of concluding the page has no such text.
const msysConvertedPattern = /^[A-Za-z]:[\\/](?:Program Files(?: \(x86\))?[\\/]Git|msys64|msys32|Git)[\\/]/;

export function detectMsysPathConversion(args: MinimistArgs): Warning[] {
  const values: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (key === '_')
      values.push(...args._.slice(1).map(String));
    else if (typeof value === 'string')
      values.push(value);
    else if (Array.isArray(value))
      values.push(...value);
  }
  return values
      .filter(value => msysConvertedPattern.test(value) && !/\.(js|json|png|pdf|webm|yml|yaml|md|txt|zip)$/i.test(value))
      .map(value => notice('msys-path-conversion', `Argument '${value}' looks like Git Bash turned a leading "/" into a Windows path. Rerun with MSYS_NO_PATHCONV=1 in front of the command (or avoid a leading slash).`));
}

export function guardCommand(name: string, args: MinimistArgs, ctx: CommandContext): GuardResult {
  const result = guardCommandInner(name, args, ctx);
  const shellWarnings = detectMsysPathConversion(args);
  if (!shellWarnings.length)
    return result;
  return { ...result, warnings: [...(result.warnings ?? []), ...shellWarnings] };
}

function guardCommandInner(name: string, args: MinimistArgs, ctx: CommandContext): GuardResult {
  const humanized = humanizeRewrite(name, args, ctx);
  if (humanized)
    return humanized;
  switch (name) {
    case 'run-code': {
      const { denied, warnings } = scanRunCode(runCodeSource(args, process.cwd()), args.force === true);
      if (denied)
        return { kind: 'deny', message: denied };
      return { kind: 'allow', warnings };
    }
    case 'eval': {
      if (!args['main-world'])
        return { kind: 'allow' };
      const expression = args._[1];
      if (typeof expression !== 'string' || !expression)
        return { kind: 'deny', message: 'eval --main-world needs an expression' };
      const target = typeof args._[2] === 'string' ? args._[2] : undefined;
      const rewritten: MinimistArgs = { _: ['run-code', mainWorldEvalCode(expression, target)] };
      if (typeof args.filename === 'string')
        rewritten.filename = args.filename;
      return { kind: 'rewrite', args: rewritten, raw: true, warnings: [leak('main-world-eval')] };
    }
    case 'resize': {
      const width = Number(args._[1]);
      const height = Number(args._[2]);
      if (sessionIsHeaded(ctx) && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0)
        return { kind: 'rewrite', args: { _: ['run-code', windowResizeCode(width, height)] }, raw: true };
      return { kind: 'allow', warnings: [leak('viewport-emulation')] };
    }
    case 'route': {
      const warnings = [leak('route-cache')];
      if (ctx.userConfig.browser?.initScript?.length)
        warnings.push(leak('route-shadows-init'));
      return { kind: 'allow', warnings };
    }
    case 'highlight':
      return args.hide ? { kind: 'allow' } : { kind: 'allow', warnings: [leak('highlight-dom')] };
    case 'video-show-actions':
      return { kind: 'allow', warnings: [leak('highlight-dom')] };
    // The recorder exposes `__pw_recorder` on the page main world and keeps an overlay element
    // there until `recording-stop`; allowed for your own pages, never silent.
    case 'recording-start':
      return { kind: 'allow', warnings: [leak('recorder-injection')] };
    case 'tracing-start':
      return { kind: 'allow', warnings: [leak('tracing')] };
    case 'pdf': {
      if (sessionIsHeaded(ctx) === true)
        return { kind: 'deny', message: 'pdf needs a headless Chromium. Use `screenshot`, or open a throwaway session with `open --headless --isolated` (detectable) for the export.' };
      return { kind: 'allow' };
    }
    default:
      return { kind: 'allow' };
  }
}
