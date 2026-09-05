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

// `config-print` is the daemon's tool, wrapped so proxy credentials never reach a
// terminal or a transcript.

import type { ClientCommand } from '../stealth';

export function redactConfig<T>(config: T): T {
  const clone = JSON.parse(JSON.stringify(config));
  for (const options of ['launchOptions', 'contextOptions']) {
    const proxy = clone?.browser?.[options]?.proxy;
    if (proxy && typeof proxy === 'object' && typeof proxy.password === 'string' && proxy.password)
      proxy.password = '***';
  }
  return clone;
}

// The daemon returns either "### Result\n{json}" (text mode) or {"result": "{json}"} (json mode).
export function parseConfigPrint(text: string): { config: any, wrapped: boolean } {
  const trimmed = text.trim();
  const body = trimmed.replace(/^### Result\s*/, '');
  const parsed = JSON.parse(body);
  if (parsed && typeof parsed === 'object' && typeof parsed.result === 'string')
    return { config: JSON.parse(parsed.result), wrapped: true };
  return { config: parsed, wrapped: false };
}

export const configPrintCommand: ClientCommand = {
  name: 'config-print',
  async run(ctx) {
    const text = await ctx.runInSession({ _: ['config-print'] });
    const { config, wrapped } = parseConfigPrint(text);
    const redacted = JSON.stringify(redactConfig(config), null, 2);
    ctx.output.toolResult(wrapped ? JSON.stringify({ result: redacted }, null, 2) : `### Result\n${redacted}`);
  },
};
