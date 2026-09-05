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

// `batch`: run a whole flow (open ... actions ... close) in ONE process invocation.
// Two situations need it: sandboxes and CI steps that kill background processes when a
// tool call returns (the daemon would not survive between calls), and permission modes
// where every shell command is confirmed by the user (one approval, the script visible).
// Each line is a patchright-cli command line; the daemon lives for the duration of the
// batch and is closed by the script's own `close`.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import type { ClientCommand } from '../stealth';

export type BatchStep = { line: number, command: string, exitCode: number | null, output: string, error: string };

// Shell-like tokenizer: double and single quotes group, backslash escapes inside double
// quotes, `#` starts a comment when it begins a token.
export function splitCommandLine(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | undefined;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = undefined;
      } else if (ch === '\\' && quote === '"' && i + 1 < line.length && '"\\'.includes(line[i + 1])) {
        current += line[++i];
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === '\'') {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === '#' && !hasToken && !current)
      break;
    if (/\s/.test(ch)) {
      if (hasToken || current) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }
  if (quote)
    throw new Error(`Unterminated quote in: ${line}`);
  if (hasToken || current)
    tokens.push(current);
  return tokens;
}

export function parseBatchScript(text: string): { line: number, command: string, args: string[] }[] {
  const steps: { line: number, command: string, args: string[] }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#'))
      return;
    const args = splitCommandLine(line);
    if (!args.length)
      return;
    // Allow copy-pasted lines that start with the binary name.
    if (args[0] === 'patchright-cli')
      args.shift();
    if (args.length)
      steps.push({ line: index + 1, command: line, args });
  });
  return steps;
}

function invokeSelf(args: string[]): Promise<{ exitCode: number | null, output: string, error: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [process.argv[1], ...args], {
      env: process.env,
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    let error = '';
    child.stdout.on('data', data => output += data.toString());
    child.stderr.on('data', data => error += data.toString());
    child.on('error', reject);
    child.on('close', exitCode => resolve({ exitCode, output: output.trimEnd(), error: error.trimEnd() }));
  });
}

async function readScript(source: string | undefined): Promise<string> {
  if (!source || source === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin)
      chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  }
  return fs.readFileSync(path.resolve(process.cwd(), source), 'utf8');
}

export const batchCommand: ClientCommand = {
  name: 'batch',
  async run(ctx) {
    const file = typeof ctx.args._[1] === 'string' ? ctx.args._[1] : undefined;
    const steps = parseBatchScript(await readScript(file));
    if (!steps.length)
      throw new Error('batch: the script has no commands (one patchright-cli command per line; # starts a comment)');
    const continueOnError = ctx.args['continue-on-error'] === true;
    const sessionArgs = ctx.args.session ? [`-s=${ctx.args.session}`] : [];
    const results: BatchStep[] = [];
    let failed = false;
    for (const step of steps) {
      const hasSession = step.args.some(a => a === '-s' || a.startsWith('-s=') || a.startsWith('--session'));
      const result = await invokeSelf([...(hasSession ? [] : sessionArgs), ...(ctx.output.json ? ['--json'] : []), ...step.args]);
      results.push({ line: step.line, command: step.command, ...result });
      if (!ctx.output.json) {
        console.log(`### ${step.line}: patchright-cli ${step.command}`);
        if (result.output)
          console.log(result.output);
        if (result.error)
          process.stderr.write(result.error + '\n');
      }
      if (result.exitCode !== 0) {
        failed = true;
        if (!continueOnError) {
          if (!ctx.output.json)
            console.log(`### batch stopped at line ${step.line} (exit ${result.exitCode}); the browser session may still be open — run \`close\` or rerun with --continue-on-error`);
          break;
        }
      }
    }
    if (ctx.output.json)
      ctx.output.toolResult(JSON.stringify({ steps: results.map(r => ({ ...r, output: tryJson(r.output) })), failed }, null, 2));
    if (failed)
      process.exitCode = 1;
  },
};

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
