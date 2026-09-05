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

// `console` is only half available on patchright. console.* calls and uncaught exceptions
// from page scripts and workers arrive through Runtime.consoleAPICalled and
// Runtime.exceptionThrown, which need the Runtime.enable call patchright never sends for
// page targets. Re-enabling it (as other ports do) reopens the primary leak, so the command
// explains instead of pretending. The Log domain is untouched: browser-level entries (failed
// requests, CSP and mixed-content violations, deprecations) still reach the daemon through
// Log.entryAdded, are counted as the "Console: N errors" of `goto`, and are shown here.

import { leak } from '../stealth/warnings';

import type { ClientCommand } from '../stealth';

export const consoleExplanation = [
  'Page console output is not available: patchright never sends Runtime.enable (the primary',
  'automation leak), so console.* calls and uncaught exceptions from page scripts and workers',
  'are not captured, and patchright-cli does not re-enable it. Browser-level log entries',
  '(failed requests, CSP and mixed-content violations, deprecations) are still recorded and',
  'listed below when there are any.',
  'To read application state use `eval --main-world "() => ..."` or `run-code`. To observe',
  'page logs on purpose, install a console/error hook with `eval --main-world` and read it back.',
].join('\n');

export const consoleCommand: ClientCommand = {
  name: 'console',
  async run(ctx) {
    ctx.output.warn(leak('console-unavailable'));
    let browserLog = '';
    try {
      browserLog = await ctx.runInSession({ _: ['console', ...ctx.args._.slice(1)], ...(ctx.args.clear ? { clear: true } : {}) }, { raw: true });
    } catch {
    }
    const hasEntries = browserLog.trim() && !/no console messages/i.test(browserLog);
    ctx.output.toolResult(hasEntries ? `${consoleExplanation}\n\nBrowser-level log entries:\n${browserLog.trim()}` : consoleExplanation);
  },
};
