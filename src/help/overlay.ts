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

// The command help ships inside patchright-core (lib/tools/cli-client/help.json) and is
// branded playwright-cli. scripts/sync-help.ts applies this overlay to it and commits the
// result as src/help/help.generated.json, so every roll produces a reviewable diff.

import { clientCommands, clientFlags } from '../stealth/flags';
import { productName } from '../paths';

import type { ClientCommandSpec, FlagType } from '../stealth/flags';

export type HelpCommand = {
  help: string;
  flags: Record<string, FlagType>;
  args: string[];
  raw?: boolean;
  variadicArg?: boolean;
};

export type HelpJson = {
  global: string;
  commands: Record<string, HelpCommand>;
  booleanOptions: string[];
};

export type GeneratedHelp = HelpJson & {
  _generatedFrom: string;
};

export type FlagSpec = { name: string, type: FlagType, help: string };

export type HelpOverlay = {
  // Applied to the global help and to every command's help text.
  rename: [RegExp, string][];
  // Commands that must not exist in our CLI (their lines are dropped from the global help too).
  removeCommands: string[];
  // Per command: flags that are not supported and must not be documented.
  removeFlags: Record<string, string[]>;
  // Per command: replacement descriptions for existing flags.
  flagHelp: Record<string, Record<string, string>>;
  // Per command: client-only flags to document and accept.
  addFlags: Record<string, FlagSpec[]>;
  // Client-only commands, grouped into their own global-help sections.
  addCommands: ClientCommandSpec[];
};

// Same 30-column gap as patchright-core's own help renderer.
const GAP = 30;

export function formatLine(prefix: string, text: string): string {
  const head = `  ${prefix}`;
  return head.length >= GAP ? `${head} ${text}` : `${head.padEnd(GAP)}${text}`;
}

export const overlay: HelpOverlay = {
  rename: [
    [/\bplaywright-cli\b/g, productName],
  ],
  removeCommands: [],
  removeFlags: {
    attach: ['extension'],
  },
  flagHelp: {
    open: {
      browser: 'chromium channel to use: chrome (default), msedge or chromium (bundled, detectable). firefox and webkit are not supported.',
      config: 'path to a patchright-cli config file, defaults to .playwright/patchright-cli.config.json',
      headed: 'run headed (visible window); the default is headless. use for interactive login, captchas, manual inspection, debugging you must watch, or a site that blocks headless. needs a display (xvfb-run -a on headless linux). --headful is an alias',
      persistent: 'use the persistent per-session profile (already the default; see --isolated)',
    },
    attach: {
      config: 'path to a patchright-cli config file, defaults to .playwright/patchright-cli.config.json',
    },
  },
  addFlags: groupFlags(),
  addCommands: clientCommands,
};

function groupFlags(): Record<string, FlagSpec[]> {
  const result: Record<string, FlagSpec[]> = {};
  for (const flag of clientFlags)
    (result[flag.command] ??= []).push({ name: flag.name, type: flag.type, help: flag.help });
  return result;
}

export function applyOverlay(core: HelpJson, generatedFrom: string, o: HelpOverlay = overlay): GeneratedHelp {
  const rename = (text: string) => o.rename.reduce((acc, [from, to]) => acc.replace(from, to), text);

  const commands: Record<string, HelpCommand> = {};
  for (const [name, command] of Object.entries(core.commands)) {
    if (o.removeCommands.includes(name))
      continue;
    const flags = { ...command.flags };
    let help = rename(command.help);
    for (const flag of o.removeFlags[name] ?? []) {
      delete flags[flag];
      help = removeFlagLine(help, flag);
    }
    for (const [flag, description] of Object.entries(o.flagHelp[name] ?? {}))
      help = replaceFlagLine(help, flag, description);
    for (const flag of o.addFlags[name] ?? []) {
      flags[flag.name] = flag.type;
      help = appendFlagLine(help, flag);
    }
    commands[name] = { ...command, flags, help };
  }
  for (const spec of o.addCommands)
    commands[spec.name] = renderCommand(spec);

  const booleanOptions = [...core.booleanOptions];
  for (const flag of [...Object.values(o.addFlags).flat(), ...o.addCommands.flatMap(c => c.flags ?? [])]) {
    if (flag.type === 'boolean' && !booleanOptions.includes(flag.name))
      booleanOptions.push(flag.name);
  }

  let global = rename(core.global)
      .split('\n')
      .filter(line => !o.removeCommands.some(name => new RegExp(`^\\s{2}${escapeRegExp(name)}(\\s|$)`).test(line)))
      .join('\n');
  global = insertSections(global, o.addCommands);

  return { _generatedFrom: generatedFrom, global, commands, booleanOptions };
}

function flagLineRegExp(flag: string): RegExp {
  return new RegExp(`^\\s{2}--${escapeRegExp(flag)}(\\s.*)?$`);
}

function removeFlagLine(help: string, flag: string): string {
  const lines = help.split('\n').filter(line => !flagLineRegExp(flag).test(line));
  // Drop an "Options:" header left without options.
  return lines.filter((line, i) => !(line === 'Options:' && (i === lines.length - 1 || !lines[i + 1].startsWith('  --')))).join('\n');
}

function replaceFlagLine(help: string, flag: string, description: string): string {
  return help.split('\n').map(line => flagLineRegExp(flag).test(line) ? formatLine(`--${flag}`, description) : line).join('\n');
}

function appendFlagLine(help: string, flag: FlagSpec): string {
  const lines = help.split('\n');
  const line = formatLine(`--${flag.name}`, flag.help);
  const optionsIndex = lines.indexOf('Options:');
  if (optionsIndex === -1)
    return [...lines, 'Options:', line].join('\n');
  let end = optionsIndex + 1;
  while (end < lines.length && lines[end].startsWith('  --'))
    end++;
  lines.splice(end, 0, line);
  return lines.join('\n');
}

export function renderCommand(spec: ClientCommandSpec): HelpCommand {
  const lines = [`${productName} ${spec.usage}`, '', spec.description];
  if (spec.args?.length) {
    lines.push('', 'Arguments:');
    for (const arg of spec.args)
      lines.push(formatLine(arg.name, arg.help));
  }
  if (spec.flags?.length) {
    lines.push(spec.args?.length ? 'Options:' : '', ...(spec.args?.length ? [] : ['Options:']));
    for (const flag of spec.flags)
      lines.push(formatLine(`--${flag.name}`, flag.help));
  }
  return {
    help: lines.join('\n'),
    flags: Object.fromEntries((spec.flags ?? []).map(flag => [flag.name, flag.type])),
    args: (spec.args ?? []).map(arg => arg.name.replace(/^[<[]|[>\]]$/g, '')),
  };
}

function insertSections(global: string, specs: ClientCommandSpec[]): string {
  if (!specs.length)
    return global;
  const sections = new Map<string, string[]>();
  for (const spec of specs)
    (sections.get(spec.section) ?? sections.set(spec.section, []).get(spec.section)!).push(formatLine(spec.usage, spec.description.split(/[.:]\s/)[0].replace(/\.$/, '').toLowerCase()));
  const block: string[] = [];
  for (const [section, lines] of sections)
    block.push(`${section}:`, ...lines, '');
  const lines = global.split('\n');
  const anchor = lines.findIndex(line => line === 'Browser sessions:' || line === 'Global options:');
  if (anchor === -1)
    return [global.trimEnd(), '', ...block].join('\n');
  lines.splice(anchor, 0, ...block);
  return lines.join('\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
