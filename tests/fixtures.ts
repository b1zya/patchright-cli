/**
 * Copyright (c) Microsoft Corporation.
 * Modifications for patchright-cli (https://github.com/b1zya/patchright-cli).
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

import { spawn } from 'child_process';
import path from 'path';

import { test } from 'patchright/test';

export type CliResult = {
  output: string;
  error: string;
  exitCode: number | null;
};

export const cliPath = path.join(__dirname, '..', 'bin', 'patchright-cli.js');

// Every CLI run gets its own state root under the test output dir, so sessions, profiles
// and the update-check cache never touch the real user cache.
export function homeDir(): string {
  return test.info().outputPath('home');
}

export async function runCli(args: string[], env: Record<string, string> = {}, cwd?: string): Promise<CliResult> {
  return new Promise<CliResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const childProcess = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        PATCHRIGHT_CLI_HOME: homeDir(),
        NO_UPDATE_NOTIFIER: '1',
        PWTEST_CLI_CHANNEL_SCAN_DISABLED_FOR_TEST: '1',
        // The tests may themselves run inside an agent harness; the CLI must not see its
        // markers (session lifetime defaults, host hints) unless a test sets them.
        CLAUDECODE: '', CLAUDE_CODE: '', CLAUDE_PID: '', PATCHRIGHT_CLI_OWNER_PID: '',
        CODEX_SANDBOX: '', CODEX_SANDBOX_NETWORK_DISABLED: '', CODEX_CI: '', COPILOT_CLI: '', CURSOR_AGENT: '', GEMINI_CLI: '', AIDER_MODEL: '',
        ...env,
      },
      cwd: cwd ?? test.info().outputPath(),
    });

    childProcess.stdout?.on('data', data => {
      stdout += data.toString();
    });

    childProcess.stderr?.on('data', data => {
      stderr += data.toString();
    });

    childProcess.on('close', code => {
      resolve({
        output: stdout.trim(),
        error: stderr.trim(),
        exitCode: code,
      });
    });

    childProcess.on('error', reject);
  });
}

export function parseJson<T = any>(result: CliResult): T {
  return JSON.parse(result.output) as T;
}
